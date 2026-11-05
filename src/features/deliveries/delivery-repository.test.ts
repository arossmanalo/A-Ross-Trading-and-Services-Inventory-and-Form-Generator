/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEED_SEQUENCES_SQL, schemaSql } from '@/test-utils/schema';

let idCounter = 0;
vi.mock('expo-crypto', () => ({
  randomUUID: () => `df-id-${++idCounter}`,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async () => 'ABCDEF1234567890',
}));
beforeEach(() => vi.useFakeTimers({ now: new Date('2026-09-05T12:00:00.000Z') }));
afterEach(() => vi.useRealTimers());

import {
  addDeliveryItemLine,
  createDeliveryDraft,
  deleteDeliveryDraft,
  finalizeDelivery,
  getDelivery,
  listDeliveries,
  removeDeliveryLine,
  updateDeliveryDraft,
  updateDeliveryLineQuantity,
  voidDelivery,
} from './delivery-repository';
import { buildDeliveryHtml } from './delivery-template';

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

describe('delivery repository', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(() => {
    idCounter = 0;
    raw = new DatabaseSync(':memory:');
    const now = '2026-09-05T00:00:00.000Z';
    raw.exec(`PRAGMA foreign_keys=ON;${schemaSql()}${SEED_SEQUENCES_SQL}`);
    raw.prepare("INSERT INTO app_meta(key,value) VALUES('database_revision','0')").run();
    raw.prepare("INSERT INTO settings(id,business_name,business_address,contact_details,owner_name,created_at,updated_at) VALUES('business','A.Ross','Quezon','0917','Owner',?,?)").run(now, now);
    raw.prepare("INSERT INTO customers(id,name,address,active,created_at,updated_at) VALUES('customer','Laundry','Sariaya',1,?,?)").run(now, now);
    raw.prepare("INSERT INTO items(id,name,unit_label,base_selling_price_centavos,active,created_at,updated_at) VALUES('item','Detergent','carboy',120000,1,?,?)").run(now, now);
    raw.prepare("INSERT INTO items(id,name,unit_label,base_selling_price_centavos,active,created_at,updated_at) VALUES('softener','Softener','gal',80000,1,?,?)").run(now, now);
    raw.prepare("INSERT INTO inventory_movements(id,item_id,movement_type,quantity_delta_integer,description,created_at) VALUES('open1','item','restock',10,'Opening',?)").run(now);
    raw.prepare("INSERT INTO inventory_movements(id,item_id,movement_type,quantity_delta_integer,description,created_at) VALUES('open2','softener','restock',3,'Opening',?)").run(now);
    db = adapter(raw);
  });
  afterEach(() => raw.close());

  const stockOf = (itemId: string) => (raw.prepare('SELECT COALESCE(SUM(quantity_delta_integer),0) AS stock FROM inventory_movements WHERE item_id=?').get(itemId) as { stock: number }).stock;

  async function readyDraft() {
    const id = await createDeliveryDraft(db, { customerId: 'customer', businessDate: '2026-09-05', deliveredBy: 'Driver', receivedBy: 'Clerk' });
    await addDeliveryItemLine(db, id, { itemId: 'item', quantity: 4 });
    return id;
  }

  it('builds a draft with priced item lines, one per item, and keeps the total current', async () => {
    const id = await readyDraft();
    await addDeliveryItemLine(db, id, { itemId: 'softener', quantity: 2 });
    await expect(addDeliveryItemLine(db, id, { itemId: 'item', quantity: 1 })).rejects.toThrow(/already on this delivery/);
    expect(await getDelivery(db, id)).toMatchObject({
      dfNumber: null, documentState: 'draft', deliveredBy: 'Driver', receivedBy: 'Clerk', totalCentavos: 640000,
      lines: [{ itemId: 'item', quantity: 4, unitPriceCentavos: 120000, amountCentavos: 480000, priceSource: 'base', currentStock: 10 }, { itemId: 'softener', quantity: 2, amountCentavos: 160000 }],
    });
    const [first] = (await getDelivery(db, id))!.lines;
    await updateDeliveryLineQuantity(db, id, first.id, 5);
    expect((await getDelivery(db, id))?.totalCentavos).toBe(760000);
    await removeDeliveryLine(db, id, first.id);
    expect((await getDelivery(db, id))?.totalCentavos).toBe(160000);
    await updateDeliveryDraft(db, id, { businessDate: '2026-09-04', deliveredBy: 'New driver', receivedBy: '', notes: 'Gate 2' });
    expect(await getDelivery(db, id)).toMatchObject({ businessDate: '2026-09-04', deliveredBy: 'New driver', notes: 'Gate 2' });
  });

  it('uses a customer price and needs a reason to override it', async () => {
    raw.prepare("INSERT INTO customer_item_prices(id,customer_id,item_id,selling_price_centavos,effective_from,created_at) VALUES('price','customer','item',100000,'2026-01-01','2026-01-01T00:00:00.000Z')").run();
    const id = await createDeliveryDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    await expect(addDeliveryItemLine(db, id, { itemId: 'item', quantity: 1, unitPriceCentavos: 90000 })).rejects.toThrow(/reason/);
    await addDeliveryItemLine(db, id, { itemId: 'item', quantity: 1 });
    expect((await getDelivery(db, id))?.lines[0]).toMatchObject({ priceSource: 'customer', unitPriceCentavos: 100000 });
  });

  it('finalizes: next DF number, frozen form, and stock deducted once', async () => {
    const id = await readyDraft();
    await addDeliveryItemLine(db, id, { itemId: 'softener', quantity: 3 });
    const result = await finalizeDelivery(db, id);
    expect(result.dfNumber).toBe('DF-000001');
    expect(result.html).toContain('Delivery Form');
    expect(result.html).toContain('Detergent');
    expect(result.html).not.toContain('₱'); // prices are kept for billing but not printed
    expect(await getDelivery(db, id)).toMatchObject({ dfNumber: 'DF-000001', documentState: 'finalized', pdfState: 'pending', totalCentavos: 720000 });
    expect(stockOf('item')).toBe(6);
    expect(stockOf('softener')).toBe(0);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM stock_transactions WHERE delivery_id=? AND transaction_type='sale' AND state='active'").get(id)).toEqual({ n: 1 });
    // Finalizing again returns the stored form without a new number or a second deduction.
    expect((await finalizeDelivery(db, id)).dfNumber).toBe('DF-000001');
    expect(stockOf('item')).toBe(6);
    await expect(addDeliveryItemLine(db, id, { itemId: 'softener', quantity: 1 })).rejects.toThrow(/draft delivery/);
    await expect(deleteDeliveryDraft(db, id)).rejects.toThrow(/draft/);
  });

  it('rejects an empty delivery, an inactive item and a shortage without changing anything', async () => {
    const empty = await createDeliveryDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    await expect(finalizeDelivery(db, empty)).rejects.toThrow(/at least one/);

    const short = await createDeliveryDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    await addDeliveryItemLine(db, short, { itemId: 'softener', quantity: 4 });
    await expect(finalizeDelivery(db, short)).rejects.toThrow(/Softener: only 3 available, 4 required/);
    expect(stockOf('softener')).toBe(3);
    expect(raw.prepare("SELECT high_water_mark FROM sequences WHERE name='DF'").get()).toEqual({ high_water_mark: 0 });
    expect(await getDelivery(db, short)).toMatchObject({ documentState: 'draft', dfNumber: null });

    raw.prepare("UPDATE items SET active=0 WHERE id='softener'").run();
    await expect(finalizeDelivery(db, short)).rejects.toThrow(/inactive/);
  });

  it('checks the whole delivery before posting any stock', async () => {
    const id = await createDeliveryDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    await addDeliveryItemLine(db, id, { itemId: 'item', quantity: 2 });
    await addDeliveryItemLine(db, id, { itemId: 'softener', quantity: 9 });
    await expect(finalizeDelivery(db, id)).rejects.toThrow(/only 3 available/);
    expect(stockOf('item')).toBe(10);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM stock_transactions WHERE delivery_id=?').get(id)).toEqual({ n: 0 });
  });

  it('voids with a disposition per item, returning only the items that came back', async () => {
    const id = await readyDraft();
    await addDeliveryItemLine(db, id, { itemId: 'softener', quantity: 3 });
    await finalizeDelivery(db, id);
    await expect(voidDelivery(db, id, '  ', [])).rejects.toThrow(/reason/);
    await expect(voidDelivery(db, id, 'Wrong customer', [{ itemId: 'item', returnedToStock: true }])).rejects.toThrow(/disposition/);
    await voidDelivery(db, id, 'Wrong customer', [{ itemId: 'item', returnedToStock: true }, { itemId: 'softener', returnedToStock: false }]);
    expect(await getDelivery(db, id)).toMatchObject({ documentState: 'voided', voidReason: 'Wrong customer' });
    expect(stockOf('item')).toBe(10);
    expect(stockOf('softener')).toBe(0);
    expect(raw.prepare("SELECT state FROM stock_transactions WHERE delivery_id=? AND transaction_type='sale'").get(id)).toEqual({ state: 'voided' });
    await expect(voidDelivery(db, id, 'Again', [])).rejects.toThrow(/finalized/);
  });

  it('cannot be voided while a live Billing Statement bills it', async () => {
    const id = await readyDraft();
    await finalizeDelivery(db, id);
    raw.prepare("INSERT INTO billing_statements(id,customer_id,business_date,source_delivery_id,created_at) VALUES('bs','customer','2026-09-05',?,'2026-09-05T00:00:00.000Z')").run(id);
    await expect(voidDelivery(db, id, 'Mistake', [{ itemId: 'item', returnedToStock: true }])).rejects.toThrow(/first/);
    expect(stockOf('item')).toBe(6);
    raw.prepare("UPDATE billing_statements SET document_state='voided' WHERE id='bs'").run();
    await voidDelivery(db, id, 'Mistake', [{ itemId: 'item', returnedToStock: true }]);
    expect(stockOf('item')).toBe(10);
  });

  it('lists deliveries with searchable text and deletes only unlinked drafts', async () => {
    const id = await readyDraft();
    const other = await createDeliveryDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    await finalizeDelivery(db, id);
    const list = await listDeliveries(db);
    expect(list).toHaveLength(2);
    expect(list.find((entry) => entry.id === id)).toMatchObject({ dfNumber: 'DF-000001', totalCentavos: 480000 });
    expect(list.find((entry) => entry.id === id)?.searchText).toContain('detergent');
    await deleteDeliveryDraft(db, other);
    expect(await getDelivery(db, other)).toBeNull();
  });
});

describe('delivery template', () => {
  it('shows items and quantities, both people and signature slots, and escapes text', () => {
    const html = buildDeliveryHtml({
      dfNumber: 'DF-000009', businessDate: '2026-09-01', fingerprint: 'AB12',
      business: { name: 'A.Ross', address: 'Addr', contactDetails: '0917' }, customer: { name: 'Quicklean <Co>', address: 'Somewhere' },
      deliveredBy: 'Driver', receivedBy: 'Clerk', notes: 'Leave at <gate>',
      lines: [{ description: 'Filter', quantity: 2, unitLabel: 'pc' }, { description: 'Belt', quantity: 5, unitLabel: 'pc' }],
    });
    expect(html).toContain('<h1 class="title">Delivery Form</h1>');
    expect(html).toContain('DF-000009');
    expect(html).toContain('Delivered by Driver');
    expect(html).toContain('Received by Clerk');
    expect(html).toContain('Quicklean &lt;Co&gt;');
    expect(html).toContain('Leave at &lt;gate&gt;');
    expect(html).toContain('Total quantity</span><span>7');
    expect(html).toContain('data-signature-role="customer"');
    expect(html).toContain('data-signature-role="preparer"');
  });
});
