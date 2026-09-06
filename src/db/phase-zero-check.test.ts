/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runDatabaseSelfCheck } from './phase-zero-check';

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

describe('database self-check', () => {
  let raw: DatabaseSync;

  beforeEach(() => { raw = new DatabaseSync(':memory:'); raw.exec('PRAGMA user_version = 6;'); });
  afterEach(() => raw.close());

  it('confirms the exclusive transaction rollback probe is clean', async () => {
    const result = await runDatabaseSelfCheck(adapter(raw));
    expect(result.rollbackVerified).toBe(true);
    expect(result.schemaVersion).toBe(6);
    expect(result.sqliteVersion).not.toBe('unknown');
    expect(raw.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='phase_zero_rollback_probe'").get()).toEqual({ count: 0 });
  });
});
