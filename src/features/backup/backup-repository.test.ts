/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5 } from '@/db/schema';

const files = new Map<string, string>();
let idCounter = 0;

vi.mock('expo-crypto', () => ({
  randomUUID: () => `backup-id-${++idCounter}`,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => `sha-${value.length}`,
}));

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file://documents/',
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  makeDirectoryAsync: async () => undefined,
  writeAsStringAsync: async (path: string, contents: string) => files.set(path, contents),
  readAsStringAsync: async (path: string) => {
    const contents = files.get(path);
    if (!contents) throw new Error(`Missing ${path}`);
    return contents;
  },
  getInfoAsync: async (path: string) => ({ exists: files.has(path), isDirectory: false, size: files.get(path)?.length ?? 0 }),
}));

vi.mock('expo-sharing', () => ({
  isAvailableAsync: async () => true,
  shareAsync: async () => undefined,
}));

import { createBackupPackage, getBackupStatus } from '@/features/backup/backup-repository';

type Params = Array<string | number | null>;
function adapter(database: DatabaseSync): SQLiteDatabase {
  const api = {
    getFirstAsync: async <T>(sql: string, ...params: Params) => database.prepare(sql).get(...params) as T | undefined,
    getAllAsync: async <T>(sql: string, ...params: Params) => database.prepare(sql).all(...params) as T[],
    runAsync: async (sql: string, ...params: Params) => {
      const result = database.prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    withExclusiveTransactionAsync: async <T>(task: (tx: SQLiteDatabase) => Promise<T>) => {
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = await task(api as unknown as SQLiteDatabase);
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return api as unknown as SQLiteDatabase;
}

describe('backup repository', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(() => {
    idCounter = 0;
    files.clear();
    raw = new DatabaseSync(':memory:');
    raw.exec(`PRAGMA foreign_keys=ON;${SCHEMA_V1}${SCHEMA_V2}${SCHEMA_V3}${SCHEMA_V4}${SCHEMA_V5}`);
    raw.exec("INSERT INTO app_meta(key,value) VALUES('database_revision','3');");
    raw.exec("INSERT INTO sequences(name,high_water_mark) VALUES('CSR',1),('BS',1),('PA',1);");
    raw.exec("INSERT INTO settings(id,business_name,business_address,contact_details,owner_name,created_at,updated_at) VALUES('business','A.Ross','Quezon','0917','Owner','2026-09-01','2026-09-01');");
    raw.exec("INSERT INTO customers(id,name,created_at,updated_at) VALUES('customer','Laundry','2026-09-01','2026-09-01');");
    raw.exec("INSERT INTO customer_equipment(id,customer_id,machine_type,created_at,updated_at) VALUES('equipment','customer','Washer','2026-09-01','2026-09-01');");
    raw.exec("INSERT INTO service_reports(id,csr_number,customer_id,equipment_id,document_state,service_outcome,business_date,created_at,finalized_at) VALUES('csr','CSR-000001','customer','equipment','finalized','completed','2026-09-01','2026-09-01','2026-09-01T00:00:00Z');");
    files.set('file://documents/signed/CSR-000001-signed.pdf', 'JVBERi0=');
    raw.exec("INSERT INTO document_attachments(id,owner_type,owner_id,attachment_type,deterministic_filename,private_path,checksum,created_at) VALUES('signed','service_report','csr','external_signed_pdf','CSR-000001-signed.pdf','file://documents/signed/CSR-000001-signed.pdf','sha-8','2026-09-02');");
    db = adapter(raw);
  });

  afterEach(() => raw.close());

  it('exports a .arossbackup package, records coverage, and clears the seven-day notice', async () => {
    await expect(getBackupStatus(db, new Date('2026-09-10T00:00:00Z'))).resolves.toMatchObject({ currentRevision: 3, revisionsNotExported: 3, finalizedRecordCount: 1, noticeDue: true });
    const result = await createBackupPackage(db);
    expect(result.filename).toMatch(/\.arossbackup$/);
    expect(result.manifest.highestRevision).toBe(4);
    expect(result.manifest.assets).toMatchObject([{ filename: 'CSR-000001-signed.pdf', zipPath: 'assets/CSR-000001-signed.pdf', checksum: 'sha-8' }]);
    expect(files.get(result.fileUri)?.startsWith('UEsDB')).toBe(true);
    await expect(getBackupStatus(db, new Date('2026-09-10T00:00:00Z'))).resolves.toMatchObject({ currentRevision: 4, revisionsNotExported: 0, noticeDue: false });
  });

  it('fails when a required external signed attachment is missing', async () => {
    files.clear();
    await expect(createBackupPackage(db)).rejects.toThrow(/Signed file is missing/);
    expect(raw.prepare('SELECT COUNT(*) AS count FROM backup_manifests').get()).toEqual({ count: 0 });
  });
});
