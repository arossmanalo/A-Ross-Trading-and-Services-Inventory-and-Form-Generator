import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { DATABASE_VERSION } from '@/db/schema';
import {
  DATA_TABLES,
  createBackupPackage,
  safeAssetName,
  type BackupAssetManifest,
  type BackupFileManifest,
  type BackupRow,
  type BackupTableName,
} from '@/features/backup/backup-repository';
import { base64ToBytes, bytesToBase64, readStoredZip, type StoredZipArchive } from '@/features/backup/zip';

const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const REQUIRED_ENTRIES = new Set(['manifest.json', 'data/tables.json']);

const SIGNATURE_CAPTURE_TRIGGERS = `
CREATE TRIGGER signature_captures_immutable
BEFORE UPDATE OF id,owner_type,owner_id,role,signer_name,png_data_url,created_at,render_template_snapshot,deterministic_filename ON signature_captures
BEGIN SELECT RAISE(ABORT, 'SIGNATURE_IS_IMMUTABLE'); END;
CREATE TRIGGER signature_captures_no_delete BEFORE DELETE ON signature_captures
BEGIN SELECT RAISE(ABORT, 'SIGNATURE_IS_IMMUTABLE'); END;
`;

export type ParsedBackupPackage = {
  manifest: BackupFileManifest;
  tables: Record<BackupTableName, BackupRow[]>;
  entries: StoredZipArchive;
};

export type BackupRestoreResult = {
  filename: string;
  highestRevision: number;
  safetyExportFilename: string | null;
  restoredExternalAssetCount: number;
};

/** Parse and validate the structural shape before any checksum or DB work. */
export function parseBackupPackage(bytes: Uint8Array): ParsedBackupPackage {
  if (bytes.length === 0 || bytes.length > MAX_PACKAGE_BYTES) throw new Error('Backup file is empty or larger than 100 MB.');
  const entries = readStoredZip(bytes);
  for (const path of entries.keys()) {
    if (!REQUIRED_ENTRIES.has(path) && !path.startsWith('assets/')) throw new Error(`Unexpected backup entry: ${path}`);
  }
  const manifest = parseManifest(readJson(entries, 'manifest.json'));
  const payload = readJson(entries, 'data/tables.json');
  if (!isRecord(payload) || !isRecord(payload.tables)) throw new Error('Backup data/tables.json is invalid.');

  const tableKeys = Object.keys(payload.tables);
  const legacyMissing = [
    ...(manifest.schemaVersion < 6 ? ['service_report_service_usage'] : []),
    ...(manifest.schemaVersion < 5 ? ['signature_captures'] : []),
  ];
  if (tableKeys.some(table => !DATA_TABLES.includes(table as BackupTableName)) || DATA_TABLES.some(table => !tableKeys.includes(table) && !legacyMissing.includes(table))) {
    throw new Error('Backup table set does not match the supported schema.');
  }
  const tables = {} as Record<BackupTableName, BackupRow[]>;
  for (const table of DATA_TABLES) {
    const rows = payload.tables[table];
    if (rows === undefined && legacyMissing.includes(table)) continue;
    if (!Array.isArray(rows)) throw new Error(`Backup table ${table} is invalid.`);
    if (rows.length !== manifest.recordCounts[table]) throw new Error(`Backup record count mismatch for ${table}.`);
    tables[table] = rows.map((row, index) => parseRow(row, `${table}[${index}]`));
  }

  const externalRows = tables.document_attachments.filter(row => row.attachment_type === 'external_signed_pdf');
  if (externalRows.some(row => !manifest.assets.some(asset => asset.attachmentId === row.id && asset.filename === row.deterministic_filename && asset.checksum === row.checksum))) {
    throw new Error('Backup contains a signed attachment that is not represented in its asset manifest.');
  }
  if (manifest.assets.some(asset => !externalRows.some(row => row.id === asset.attachmentId && row.deterministic_filename === asset.filename))) {
    throw new Error('Backup asset manifest contains an attachment that is not in the database dump.');
  }

  const assetPaths = new Set<string>();
  for (const asset of manifest.assets) {
    if (assetPaths.has(asset.zipPath)) throw new Error(`Duplicate backup asset path: ${asset.zipPath}`);
    assetPaths.add(asset.zipPath);
    const data = entries.get(asset.zipPath);
    if (!data) throw new Error(`Backup asset is missing: ${asset.filename}`);
    if (data.length !== asset.size) throw new Error(`Backup asset size mismatch: ${asset.filename}`);
  }
  for (const path of entries.keys()) {
    if (path.startsWith('assets/') && !assetPaths.has(path)) throw new Error(`Unlisted backup asset: ${path}`);
  }
  return { manifest, tables, entries };
}

/** Verify the manifest and every non-regenerable asset checksum. */
export async function validateBackupPackage(bytes: Uint8Array): Promise<ParsedBackupPackage> {
  const parsed = parseBackupPackage(bytes);
  const payloadJson = stableJson({ tables: parsed.tables });
  const payloadChecksum = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payloadJson);
  const { checksum, ...manifestWithoutChecksum } = parsed.manifest;
  const expectedManifestChecksum = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    stableJson({ payloadChecksum, manifestWithoutChecksum }),
  );
  if (expectedManifestChecksum !== checksum) throw new Error('Backup manifest checksum does not match its data.');
  for (const asset of parsed.manifest.assets) {
    const data = parsed.entries.get(asset.zipPath);
    if (!data) throw new Error(`Backup asset is missing: ${asset.filename}`);
    const actual = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, bytesToBase64(data));
    if (actual !== asset.checksum) throw new Error(`Backup asset checksum does not match: ${asset.filename}`);
  }
  return migrateLegacyPackage(parsed);
}

/**
 * Replace the local database with a validated package. The safety export is
 * made before the destructive transaction and remains on-device if restore
 * fails. External signed PDFs are materialized before the transaction and are
 * removed again if the database write fails.
 */
export async function restoreBackupPackage(db: SQLiteDatabase, bytes: Uint8Array, sourceFilename = 'imported-backup.arossbackup'): Promise<BackupRestoreResult> {
  const parsed = await validateBackupPackage(bytes);
  if (!FileSystem.documentDirectory) throw new Error('Persistent document storage is unavailable.');
  const hadLocalData = await hasLocalData(db);
  const safetyExport = hadLocalData ? await createBackupPackage(db) : null;
  const writtenAssets = await materializeAssets(parsed);
  try {
    const restoreId = Crypto.randomUUID();
    await db.withExclusiveTransactionAsync(async tx => {
      await validateColumns(tx, parsed.tables);
      await tx.execAsync('DROP TRIGGER IF EXISTS signature_captures_immutable; DROP TRIGGER IF EXISTS signature_captures_no_delete;');
      for (const table of [...DATA_TABLES].reverse()) await tx.runAsync(`DELETE FROM ${table}`);
      for (const table of DATA_TABLES) {
        for (const row of parsed.tables[table]) {
          const restored = restoreRow(table, row, parsed.manifest.assets);
          await insertRow(tx, table, restored);
        }
      }
      // Generated PDFs are reproducible from frozen snapshots but are not
      // carried in the package. Make their retry state explicit after import.
      await tx.runAsync("UPDATE service_reports SET pdf_state='not_generated',share_state='not_shared' WHERE document_state='finalized'");
      await tx.runAsync("UPDATE billing_statements SET pdf_state='not_generated',share_state='not_shared' WHERE document_state='finalized'");
      await tx.runAsync("UPDATE payments SET pdf_state='not_generated',share_state='not_shared' WHERE state='active'");
      await tx.runAsync(
        'INSERT INTO backup_manifests(id,filename,schema_version,highest_revision,record_counts_json,checksum,created_at) VALUES(?,?,?,?,?,?,?)',
        restoreId,
        sourceFilename,
        parsed.manifest.schemaVersion,
        parsed.manifest.highestRevision,
        JSON.stringify(parsed.manifest.recordCounts),
        parsed.manifest.checksum,
        parsed.manifest.exportedAt,
      );
      await tx.runAsync("UPDATE app_meta SET value=? WHERE key='database_revision'", String(parsed.manifest.highestRevision));
      await tx.execAsync(SIGNATURE_CAPTURE_TRIGGERS);
      await appendAuditEvent(tx, {
        eventType: 'backup.restored',
        entityType: 'backup_manifest',
        entityId: restoreId,
        details: { filename: sourceFilename, highestRevision: parsed.manifest.highestRevision, safetyExportCreated: hadLocalData },
      });
      await incrementDatabaseRevision(tx);
    });
  } catch (error) {
    for (const path of writtenAssets) await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
    throw error;
  }
  return {
    filename: sourceFilename,
    highestRevision: parsed.manifest.highestRevision,
    safetyExportFilename: safetyExport?.filename ?? null,
    restoredExternalAssetCount: parsed.manifest.assets.length,
  };
}

export async function readBackupFile(uri: string): Promise<Uint8Array> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.isDirectory || (typeof info.size === 'number' && info.size > MAX_PACKAGE_BYTES)) throw new Error('Select a valid .arossbackup file no larger than 100 MB.');
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const bytes = base64ToBytes(base64);
  if (bytes.length === 0) throw new Error('Selected backup file is empty.');
  return bytes;
}

async function hasLocalData(db: SQLiteDatabase): Promise<boolean> {
  const rows = await Promise.all(DATA_TABLES.filter(table => !['app_meta', 'sequences', 'settings', 'backup_manifests', 'audit_events'].includes(table)).map(table => db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)));
  return rows.some(row => (row?.count ?? 0) > 0);
}

async function materializeAssets(parsed: ParsedBackupPackage): Promise<string[]> {
  const written: string[] = [];
  const destinationDirectory = `${FileSystem.documentDirectory}documents/signed/`;
  await FileSystem.makeDirectoryAsync(destinationDirectory, { intermediates: true });
  const destinations = new Set<string>();
  try {
    for (const asset of parsed.manifest.assets) {
      const destination = `${destinationDirectory}${safeAssetName(asset.filename)}`;
      if (destinations.has(destination)) throw new Error(`Backup assets resolve to the same filename: ${asset.filename}`);
      destinations.add(destination);
      const existing = await FileSystem.getInfoAsync(destination);
      if (existing.exists) {
        const current = await FileSystem.readAsStringAsync(destination, { encoding: FileSystem.EncodingType.Base64 });
        const currentChecksum = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, current);
        if (currentChecksum !== asset.checksum) throw new Error(`A different signed file already exists: ${asset.filename}`);
        continue;
      }
      const data = parsed.entries.get(asset.zipPath);
      if (!data) throw new Error(`Backup asset is missing: ${asset.filename}`);
      await FileSystem.writeAsStringAsync(destination, bytesToBase64(data), { encoding: FileSystem.EncodingType.Base64 });
      written.push(destination);
    }
    return written;
  } catch (error) {
    for (const path of written) await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
    throw error;
  }
}

async function validateColumns(db: SQLiteDatabase, tables: Record<BackupTableName, BackupRow[]>): Promise<void> {
  for (const table of DATA_TABLES) {
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    const names = columns.map(column => column.name);
    for (const [index, row] of tables[table].entries()) {
      const rowNames = Object.keys(row);
      if (rowNames.length !== names.length || names.some(name => !Object.prototype.hasOwnProperty.call(row, name))) {
        throw new Error(`Backup columns do not match ${table} at row ${index}.`);
      }
    }
  }
}

async function insertRow(db: SQLiteDatabase, table: BackupTableName, row: BackupRow): Promise<void> {
  const columns = Object.keys(row);
  const quoted = columns.map(column => `"${column.replaceAll('"', '""')}"`).join(',');
  const placeholders = columns.map(() => '?').join(',');
  await db.runAsync(`INSERT INTO ${table} (${quoted}) VALUES (${placeholders})`, ...columns.map(column => row[column]));
}

function restoreRow(table: BackupTableName, row: BackupRow, assets: BackupAssetManifest[]): BackupRow {
  const restored = { ...row };
  if (table === 'document_attachments') {
    const attachmentType = restored.attachment_type;
    if (attachmentType === 'external_signed_pdf') {
      const asset = assets.find(candidate => candidate.attachmentId === restored.id);
      if (!asset) throw new Error(`Signed attachment is not listed in the backup: ${String(restored.id)}`);
      restored.private_path = `${FileSystem.documentDirectory}documents/signed/${safeAssetName(asset.filename)}`;
    } else if (attachmentType === 'generated_pdf' || attachmentType === 'signature_image') {
      restored.private_path = '';
      restored.checksum = '';
    }
  }
  if (table === 'signature_captures' && restored.pdf_state === 'ready') {
    restored.pdf_state = 'pending';
    restored.private_path = null;
    restored.checksum = null;
  }
  return restored;
}

function parseManifest(value: unknown): BackupFileManifest {
  if (!isRecord(value) || value.app !== 'a-ross-inventory-and-form-generator' || value.format !== 'arossbackup' || value.formatVersion !== 1) throw new Error('Backup manifest format is unsupported.');
  if (!Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 1 || value.schemaVersion > DATABASE_VERSION) throw new Error(`Backup schema version ${String(value.schemaVersion)} is not supported.`);
  if (typeof value.exportedAt !== 'string' || Number.isNaN(Date.parse(value.exportedAt))) throw new Error('Backup export date is invalid.');
  if (!Number.isSafeInteger(value.highestRevision) || value.highestRevision < 0) throw new Error('Backup revision marker is invalid.');
  if (typeof value.checksum !== 'string' || !value.checksum) throw new Error('Backup manifest checksum is missing.');
  if (typeof value.warning !== 'string' || !Array.isArray(value.assets) || !isRecord(value.recordCounts)) throw new Error('Backup manifest fields are invalid.');
  const recordCounts = {} as Record<BackupTableName, number>;
  const countKeys = Object.keys(value.recordCounts);
  const expectedCountTables = DATA_TABLES.filter((table) => {
    if (table === 'service_report_service_usage') return value.schemaVersion >= 6;
    if (table === 'signature_captures') return value.schemaVersion >= 5;
    return true;
  });
  if (countKeys.some(table => !expectedCountTables.includes(table as BackupTableName)) || expectedCountTables.some(table => !countKeys.includes(table))) throw new Error('Backup record counts are invalid.');
  for (const table of expectedCountTables) {
    const count = value.recordCounts[table];
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Backup record count is invalid for ${table}.`);
    recordCounts[table as BackupTableName] = count;
  }
  const assets = value.assets.map((asset, index) => parseAsset(asset, index));
  return {
    app: 'a-ross-inventory-and-form-generator',
    format: 'arossbackup',
    formatVersion: 1,
    schemaVersion: value.schemaVersion,
    exportedAt: value.exportedAt,
    highestRevision: value.highestRevision,
    recordCounts,
    assets,
    checksum: value.checksum,
    warning: value.warning,
  };
}

function migrateLegacyPackage(parsed: ParsedBackupPackage): ParsedBackupPackage {
  if (parsed.manifest.schemaVersion === DATABASE_VERSION) return parsed;
  const tables = { ...parsed.tables };
  if (parsed.manifest.schemaVersion < 2) {
    tables.service_reports = tables.service_reports.map(row => ({ billing_json: '[]', total_bill_centavos: 0, acknowledged_by_snapshot: '', ...row }));
  }
  if (parsed.manifest.schemaVersion < 4) {
    tables.payments = tables.payments.map(row => ({ payment_kind: null, content_snapshot_json: null, render_template_snapshot: null, pdf_state: 'not_generated', share_state: 'not_shared', idempotency_key: null, ...row }));
  }
  if (parsed.manifest.schemaVersion < 5) {
    tables.settings = tables.settings.map(row => ({ business_logo_data_url: null, ...row }));
    tables.signature_captures = [];
  }
  if (parsed.manifest.schemaVersion < 6) {
    tables.service_report_service_usage = [];
  }
  const recordCounts = Object.fromEntries(DATA_TABLES.map(table => [table, tables[table].length])) as Record<BackupTableName, number>;
  return { ...parsed, tables, manifest: { ...parsed.manifest, recordCounts } };
}

function parseAsset(value: unknown, index: number): BackupAssetManifest {
  if (!isRecord(value) || typeof value.attachmentId !== 'string' || typeof value.ownerType !== 'string' || !['service_report', 'billing_statement'].includes(value.ownerType) || typeof value.ownerId !== 'string' || value.attachmentType !== 'external_signed_pdf' || typeof value.filename !== 'string' || !value.filename || typeof value.zipPath !== 'string' || !value.zipPath.startsWith('assets/') || typeof value.checksum !== 'string' || !value.checksum || !Number.isSafeInteger(value.size) || value.size <= 0) throw new Error(`Backup asset ${index} is invalid.`);
  return { attachmentId: value.attachmentId, ownerType: value.ownerType, ownerId: value.ownerId, attachmentType: 'external_signed_pdf', filename: value.filename, zipPath: value.zipPath, checksum: value.checksum, size: value.size };
}

function parseRow(value: unknown, label: string): BackupRow {
  if (!isRecord(value)) throw new Error(`Backup row ${label} is invalid.`);
  const row: BackupRow = {};
  for (const [key, cell] of Object.entries(value)) {
    if (!key || (typeof cell !== 'string' && typeof cell !== 'number' && cell !== null) || (typeof cell === 'number' && !Number.isFinite(cell))) throw new Error(`Backup row ${label} contains an invalid value.`);
    row[key] = cell;
  }
  return row;
}

function readJson(entries: StoredZipArchive, path: string): unknown {
  const data = entries.get(path);
  if (!data) throw new Error(`Backup entry is missing: ${path}`);
  try {
    return JSON.parse(new TextDecoder().decode(data)) as unknown;
  } catch {
    throw new Error(`Backup entry is not valid JSON: ${path}`);
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
