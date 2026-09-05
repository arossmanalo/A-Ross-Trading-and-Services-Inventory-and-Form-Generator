import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { DATABASE_VERSION } from '@/db/schema';
import { base64ToBytes, bytesToBase64, createStoredZip } from '@/features/backup/zip';

export type BackupStatus = {
  currentRevision: number;
  lastExport: BackupManifestSummary | null;
  revisionsNotExported: number;
  finalizedRecordCount: number;
  noticeDue: boolean;
};

export type BackupManifestSummary = {
  id: string;
  filename: string;
  schemaVersion: number;
  highestRevision: number;
  recordCounts: Record<string, number>;
  checksum: string;
  createdAt: string;
};

export type BackupExportResult = {
  fileUri: string;
  filename: string;
  manifest: BackupFileManifest;
};

export type BackupFileManifest = {
  app: 'a-ross-inventory-and-form-generator';
  format: 'arossbackup';
  formatVersion: 1;
  schemaVersion: number;
  exportedAt: string;
  highestRevision: number;
  recordCounts: Record<string, number>;
  assets: BackupAssetManifest[];
  checksum: string;
  warning: string;
};

export type BackupAssetManifest = {
  attachmentId: string;
  ownerType: string;
  ownerId: string;
  attachmentType: string;
  filename: string;
  zipPath: string;
  checksum: string;
  size: number;
};

const DATA_TABLES = [
  'app_meta',
  'sequences',
  'settings',
  'customers',
  'customer_equipment',
  'items',
  'customer_item_prices',
  'services',
  'service_reports',
  'service_report_item_usage',
  'billing_statements',
  'expenses',
  'billing_statement_lines',
  'payments',
  'stock_transactions',
  'inventory_movements',
  'document_attachments',
  'audit_events',
  'backup_manifests',
  'signature_captures',
] as const;

type BackupTableName = typeof DATA_TABLES[number];
type BackupRow = Record<string, string | number | null>;
type AttachmentRow = {
  id: string;
  owner_type: string;
  owner_id: string;
  attachment_type: string;
  deterministic_filename: string;
  private_path: string;
  checksum: string;
};
type BackupManifestRow = {
  id: string;
  filename: string;
  schema_version: number;
  highest_revision: number;
  record_counts_json: string;
  checksum: string;
  created_at: string;
};

export async function getBackupStatus(db: SQLiteDatabase, now = new Date()): Promise<BackupStatus> {
  const [revision, last, finalized] = await Promise.all([
    getDatabaseRevision(db),
    db.getFirstAsync<BackupManifestRow>('SELECT * FROM backup_manifests ORDER BY created_at DESC, rowid DESC LIMIT 1'),
    db.getFirstAsync<{ count: number; first_finalized_at: string | null }>(
      `SELECT COUNT(*) AS count, MIN(finalized_at) AS first_finalized_at FROM (
        SELECT finalized_at FROM service_reports WHERE finalized_at IS NOT NULL
        UNION ALL SELECT finalized_at FROM billing_statements WHERE finalized_at IS NOT NULL
        UNION ALL SELECT finalized_at FROM payments WHERE finalized_at IS NOT NULL
      )`,
    ),
  ]);
  const lastExport = last ? mapBackupManifest(last) : null;
  const revisionsNotExported = Math.max(0, revision - (lastExport?.highestRevision ?? 0));
  const referenceDate = lastExport?.createdAt ?? finalized?.first_finalized_at;
  const noticeDue = Boolean((finalized?.count ?? 0) > 0 && revisionsNotExported > 0 && referenceDate && daysBetween(referenceDate, now) >= 7);
  return {
    currentRevision: revision,
    lastExport,
    revisionsNotExported,
    finalizedRecordCount: finalized?.count ?? 0,
    noticeDue,
  };
}

export async function createBackupPackage(db: SQLiteDatabase): Promise<BackupExportResult> {
  if (!FileSystem.documentDirectory) throw new Error('Persistent document storage is unavailable.');
  const exportedAt = new Date().toISOString();
  const baseRevision = await getDatabaseRevision(db);
  const coveredRevision = baseRevision + 1;
  const data = await dumpTables(db);
  const { entries: assetEntries, assets } = await collectExternalSignedAssets(db);
  const recordCounts = Object.fromEntries(DATA_TABLES.map(table => [table, data[table].length]));
  const payload = { tables: data };
  const payloadJson = stableJson(payload);
  const payloadChecksum = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payloadJson);
  const filename = `aross-backup-${exportedAt.replaceAll('-', '').replaceAll(':', '').slice(0, 15)}.arossbackup`;
  const manifestWithoutChecksum: Omit<BackupFileManifest, 'checksum'> = {
    app: 'a-ross-inventory-and-form-generator',
    format: 'arossbackup',
    formatVersion: 1,
    schemaVersion: DATABASE_VERSION,
    exportedAt,
    highestRevision: coveredRevision,
    recordCounts,
    assets,
    warning: 'This backup is intentionally unencrypted and may contain customer, signature, and signed-document data. Store it only in a private location.',
  };
  const manifest: BackupFileManifest = {
    ...manifestWithoutChecksum,
    checksum: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, stableJson({ payloadChecksum, manifestWithoutChecksum })),
  };
  const zip = createStoredZip([
    { path: 'manifest.json', data: stableJson(manifest) },
    { path: 'data/tables.json', data: payloadJson },
    ...assetEntries,
  ]);
  const zipBase64 = bytesToBase64(zip);
  const fileUri = `${FileSystem.documentDirectory}backups/${filename}`;
  await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}backups/`, { intermediates: true });
  await FileSystem.writeAsStringAsync(fileUri, zipBase64, { encoding: FileSystem.EncodingType.Base64 });
  const packageChecksum = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, zipBase64);

  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      'INSERT INTO backup_manifests(id,filename,schema_version,highest_revision,record_counts_json,checksum,created_at) VALUES(?,?,?,?,?,?,?)',
      Crypto.randomUUID(),
      filename,
      DATABASE_VERSION,
      coveredRevision,
      JSON.stringify(recordCounts),
      packageChecksum,
      exportedAt,
    );
    await appendAuditEvent(tx, {
      eventType: 'backup.exported',
      entityType: 'backup_manifest',
      entityId: filename,
      details: { highestRevision: coveredRevision, assetCount: assets.length },
      createdAt: exportedAt,
    });
    await incrementDatabaseRevision(tx);
  });

  return { fileUri, filename, manifest };
}

export async function shareBackupPackage(db: SQLiteDatabase): Promise<BackupExportResult> {
  const result = await createBackupPackage(db);
  if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable on this device.');
  await Sharing.shareAsync(result.fileUri, {
    dialogTitle: 'Share backup to private Drive',
    mimeType: 'application/zip',
    UTI: 'public.zip-archive',
  });
  return result;
}

async function dumpTables(db: SQLiteDatabase): Promise<Record<BackupTableName, BackupRow[]>> {
  const entries = await Promise.all(DATA_TABLES.map(async table => [table, await db.getAllAsync<BackupRow>(`SELECT * FROM ${table} ORDER BY rowid ASC`)] as const));
  return Object.fromEntries(entries) as Record<BackupTableName, BackupRow[]>;
}

async function collectExternalSignedAssets(db: SQLiteDatabase): Promise<{ entries: Array<{ path: string; data: Uint8Array }>; assets: BackupAssetManifest[] }> {
  const rows = await db.getAllAsync<AttachmentRow>(
    `SELECT id,owner_type,owner_id,attachment_type,deterministic_filename,private_path,checksum
     FROM document_attachments
     WHERE attachment_type='external_signed_pdf'
     ORDER BY created_at ASC,rowid ASC`,
  );
  const entries: Array<{ path: string; data: Uint8Array }> = [];
  const assets: BackupAssetManifest[] = [];
  for (const row of rows) {
    const info = await FileSystem.getInfoAsync(row.private_path);
    if (!info.exists || info.isDirectory) throw new Error(`Signed file is missing and cannot be backed up: ${row.deterministic_filename}`);
    const base64 = await FileSystem.readAsStringAsync(row.private_path, { encoding: FileSystem.EncodingType.Base64 });
    const checksum = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64);
    if (row.checksum && checksum !== row.checksum) throw new Error(`Signed file checksum changed: ${row.deterministic_filename}`);
    const zipPath = `assets/${safeAssetName(row.deterministic_filename)}`;
    entries.push({ path: zipPath, data: base64ToBytes(base64) });
    assets.push({
      attachmentId: row.id,
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      attachmentType: row.attachment_type,
      filename: row.deterministic_filename,
      zipPath,
      checksum,
      size: typeof info.size === 'number' ? info.size : base64.length,
    });
  }
  return { entries, assets };
}

async function getDatabaseRevision(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_meta WHERE key='database_revision'");
  const revision = Number(row?.value ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Database revision marker is invalid.');
  return revision;
}

function mapBackupManifest(row: BackupManifestRow): BackupManifestSummary {
  return {
    id: row.id,
    filename: row.filename,
    schemaVersion: row.schema_version,
    highestRevision: row.highest_revision,
    recordCounts: parseRecordCounts(row.record_counts_json),
    checksum: row.checksum,
    createdAt: row.created_at,
  };
}

function parseRecordCounts(raw: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, number> : {};
  } catch {
    return {};
  }
}

function safeAssetName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function daysBetween(date: string, now: Date): number {
  const timestamp = Date.parse(date);
  if (Number.isNaN(timestamp)) return 0;
  return Math.floor((now.getTime() - timestamp) / 86_400_000);
}
