/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from './migrations';
import { SCHEMA_V1 } from './schema';

type Params = Array<string | number | null>;

function adapter(database: DatabaseSync): SQLiteDatabase {
  const api = {
    execAsync: async (sql: string) => { database.exec(sql); },
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

describe('database migrations', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(() => {
    raw = new DatabaseSync(':memory:');
    db = adapter(raw);
  });

  afterEach(() => raw.close());

  it('migrates a new database through version 6 with default metadata', async () => {
    await migrateDatabase(db);
    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 6 });
    expect(raw.prepare("SELECT value FROM app_meta WHERE key='database_revision'").get()).toEqual({ value: '0' });
    expect(raw.prepare('SELECT COUNT(*) AS count FROM sequences').get()).toEqual({ count: 3 });
    expect(raw.prepare("SELECT business_name,low_stock_notifications_enabled FROM settings WHERE id='business'").get()).toEqual({ business_name: 'A.Ross Trading and Services', low_stock_notifications_enabled: 1 });
  });

  it('is idempotent when the app opens an already migrated database', async () => {
    await migrateDatabase(db);
    await migrateDatabase(db);
    expect(raw.prepare('SELECT COUNT(*) AS count FROM settings').get()).toEqual({ count: 1 });
    expect(raw.prepare('SELECT COUNT(*) AS count FROM sequences').get()).toEqual({ count: 3 });
  });

  it('upgrades a version 1 database with the later snapshot and signature schema', async () => {
    raw.exec(`${SCHEMA_V1} PRAGMA user_version = 1; INSERT INTO app_meta(key,value) VALUES('database_revision','2'); INSERT INTO sequences(name,high_water_mark) VALUES('CSR',1),('BS',2),('PA',3);`);
    await migrateDatabase(db);
    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 6 });
    const paymentColumns = raw.prepare("PRAGMA table_info('payments')").all() as Array<{ name: string }>;
    expect(paymentColumns.map(column => column.name)).toEqual(expect.arrayContaining(['payment_kind', 'pdf_state', 'idempotency_key']));
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='signature_captures'").get()).toEqual({ name: 'signature_captures' });
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='service_report_service_usage'").get()).toEqual({ name: 'service_report_service_usage' });
    expect(raw.prepare("SELECT value FROM app_meta WHERE key='database_revision'").get()).toEqual({ value: '2' });
  });

  it('rejects a database created by a newer app version', async () => {
    raw.exec('PRAGMA user_version = 99;');
    await expect(migrateDatabase(db)).rejects.toThrow(/newer than supported/);
  });
});
