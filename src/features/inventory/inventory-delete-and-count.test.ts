/// <reference types="node" />

import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { schemaSql } from '@/test-utils/schema';

let idCounter = 0;
vi.mock('expo-crypto', () => ({
  randomUUID: () => `inv-id-${++idCounter}`,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => createHash('sha256').update(value).digest('hex'),
}));

import {
  deleteInventoryItem,
  getCurrentStock,
  getInventoryItemDetail,
  listInventoryItems,
  setInventoryItemStock,
} from './inventory-repository';
import { hasEditPin, setEditPin, verifyEditPin } from '@/features/settings/edit-pin';

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

const T = '2026-11-01T08:00:00Z';

describe('deleting items and setting stock counts', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(() => {
    raw = new DatabaseSync(':memory:');
    raw.exec(`PRAGMA foreign_keys=ON;${schemaSql()}`);
    db = adapter(raw);
    raw.exec("INSERT INTO app_meta(key,value) VALUES('database_revision','0');");
    raw.exec(`INSERT INTO settings(id,business_name,created_at,updated_at) VALUES('business','A.Ross','${T}','${T}');`);
    raw.exec(`INSERT INTO customers(id,name,created_at,updated_at) VALUES('customer','Laundry','${T}','${T}');`);
    raw.exec(`INSERT INTO customer_equipment(id,customer_id,machine_type,created_at,updated_at) VALUES('washer','customer','Washer','${T}','${T}');`);
    raw.exec(`INSERT INTO items(id,name,created_at,updated_at) VALUES('unused','Drain hose','${T}','${T}'),('used','Door gasket','${T}','${T}');`);
    raw.exec(`INSERT INTO inventory_movements(id,item_id,movement_type,quantity_delta_integer,description,created_at)
      VALUES('m1','unused','restock',5,'Opening','${T}'),('m2','used','restock',8,'Opening','${T}');`);
    raw.exec(`INSERT INTO customer_item_prices(id,customer_id,item_id,selling_price_centavos,effective_from,created_at)
      VALUES('p1','customer','unused',1500,'${T}','${T}');`);
    raw.exec(`INSERT INTO service_reports(id,customer_id,equipment_id,document_state,business_date,created_at)
      VALUES('csr','customer','washer','draft','2026-11-01','${T}');`);
    raw.exec(`INSERT INTO service_report_item_usage(id,service_report_id,item_id,quantity_integer,billable,description_snapshot,created_at)
      VALUES('u1','csr','used',1,1,'Door gasket','${T}');`);
  });

  afterEach(() => raw.close());

  it('erases an item no document uses, with its movements and prices', async () => {
    await expect(deleteInventoryItem(db, 'unused')).resolves.toBe('erased');
    expect(raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id='unused'").get()).toEqual({ n: 0 });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE item_id='unused'").get()).toEqual({ n: 0 });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM customer_item_prices WHERE item_id='unused'").get()).toEqual({ n: 0 });
  });

  it('hides an item a document uses, keeping it for that document', async () => {
    await expect(deleteInventoryItem(db, 'used')).resolves.toBe('hidden');
    expect((await listInventoryItems(db)).map((item) => item.id)).toEqual(['unused']);
    const detail = await getInventoryItemDetail(db, 'used');
    expect(detail?.active).toBe(false);
    expect(detail?.deletedAt).not.toBeNull();
    expect(raw.prepare("SELECT COUNT(*) AS n FROM service_report_item_usage WHERE item_id='used'").get()).toEqual({ n: 1 });
    await expect(deleteInventoryItem(db, 'used')).rejects.toThrow(/not found/);
  });

  it('records a stock count as the difference, in either direction', async () => {
    await setInventoryItemStock(db, { itemId: 'used', quantity: 3, reason: 'Shelf count' });
    expect(await getCurrentStock(db, 'used')).toBe(3);
    await setInventoryItemStock(db, { itemId: 'used', quantity: 10, reason: 'Found a box' });
    expect(await getCurrentStock(db, 'used')).toBe(10);
    const rows = raw.prepare("SELECT movement_type, quantity_delta_integer AS delta, description FROM inventory_movements WHERE item_id='used' ORDER BY rowid").all();
    expect(rows).toEqual([
      { movement_type: 'restock', delta: 8, description: 'Opening' },
      { movement_type: 'consumption', delta: -5, description: 'Stock count set to 3 (was 8): Shelf count' },
      { movement_type: 'restock', delta: 7, description: 'Stock count set to 10 (was 3): Found a box' },
    ]);
  });

  it('records nothing when the count matches, and refuses bad counts', async () => {
    await setInventoryItemStock(db, { itemId: 'used', quantity: 8, reason: 'Checked' });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE item_id='used'").get()).toEqual({ n: 1 });
    await expect(setInventoryItemStock(db, { itemId: 'used', quantity: -1, reason: 'x' })).rejects.toThrow(/whole number/);
    await expect(setInventoryItemStock(db, { itemId: 'used', quantity: 2, reason: '  ' })).rejects.toThrow(/why/);
  });

  it('keeps a hashed PIN that only the same digits match', async () => {
    expect(await hasEditPin(db)).toBe(false);
    expect(await verifyEditPin(db, '1234')).toBe(false);
    await expect(setEditPin(db, '12a4')).rejects.toThrow(/4 to 6 digits/);
    await setEditPin(db, '2468');
    expect(await hasEditPin(db)).toBe(true);
    expect(await verifyEditPin(db, '2468')).toBe(true);
    expect(await verifyEditPin(db, '2469')).toBe(false);
    const stored = raw.prepare("SELECT edit_pin_hash FROM settings WHERE id='business'").get() as { edit_pin_hash: string };
    expect(stored.edit_pin_hash).not.toContain('2468');
  });
});
