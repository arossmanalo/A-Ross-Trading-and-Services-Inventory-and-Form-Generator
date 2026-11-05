/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEED_SEQUENCES_SQL, schemaSql } from '@/test-utils/schema';

let idCounter = 0;
vi.mock('expo-crypto', () => ({
  randomUUID: () => `qt-id-${++idCounter}`,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async () => 'ABCDEF1234567890',
}));
beforeEach(() => vi.useFakeTimers({ now: new Date('2026-09-05T12:00:00.000Z') }));
afterEach(() => vi.useRealTimers());

import {
  addQuotationItemLine,
  addQuotationServiceLine,
  createQuotationDraft,
  deleteQuotationDraft,
  finalizeQuotation,
  getQuotation,
  listQuotations,
  removeQuotationLine,
  updateQuotationDraft,
  voidQuotation,
} from './quotation-repository';
import { buildQuotationHtml } from './quotation-template';

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

describe('quotation repository', () => {
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
    raw.prepare("INSERT INTO services(id,name,base_rate_centavos,active,created_at,updated_at) VALUES('service','Labor',50000,1,?,?)").run(now, now);
    db = adapter(raw);
  });
  afterEach(() => raw.close());

  const stock = () => raw.prepare("SELECT COALESCE(SUM(quantity_delta_integer),0) AS stock FROM inventory_movements").get();

  it('creates a draft that is valid for 30 days by default and validates its dates', async () => {
    const id = await createQuotationDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    expect(await getQuotation(db, id)).toMatchObject({ qtNumber: null, documentState: 'draft', businessDate: '2026-09-05', validUntil: '2026-10-05', totalCentavos: 0, lines: [] });
    await expect(createQuotationDraft(db, { customerId: 'customer', businessDate: '2026-09-05', validUntil: '2026-09-01' })).rejects.toThrow(/expire before/);
    await expect(createQuotationDraft(db, { customerId: 'missing', businessDate: '2026-09-05' })).rejects.toThrow(/active customer/);
  });

  it('prices lines like a Billing Statement and totals them with the discount', async () => {
    const id = await createQuotationDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    await addQuotationItemLine(db, id, { itemId: 'item', quantity: 2 });
    await addQuotationServiceLine(db, id, { serviceId: 'service' });
    await updateQuotationDraft(db, id, { businessDate: '2026-09-05', validUntil: '2026-09-20', discountType: 'percentage', discountValue: 1000 });
    const quotation = await getQuotation(db, id);
    expect(quotation?.lines).toMatchObject([
      { lineType: 'item', quantity: 2, unitPriceCentavos: 120000, amountCentavos: 240000, priceSource: 'base' },
      { lineType: 'service', quantity: 1, unitPriceCentavos: 50000, amountCentavos: 50000, priceSource: 'catalog' },
    ]);
    expect(quotation).toMatchObject({ subtotalCentavos: 290000, totalCentavos: 261000, validUntil: '2026-09-20' });
  });

  it('uses a customer price over the base price and requires a reason to override', async () => {
    raw.prepare("INSERT INTO customer_item_prices(id,customer_id,item_id,selling_price_centavos,effective_from,created_at) VALUES('price','customer','item',100000,'2026-01-01','2026-01-01T00:00:00.000Z')").run();
    const id = await createQuotationDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    await addQuotationItemLine(db, id, { itemId: 'item', quantity: 1 });
    await expect(addQuotationItemLine(db, id, { itemId: 'item', quantity: 1, unitPriceCentavos: 90000 })).rejects.toThrow(/reason/);
    await addQuotationItemLine(db, id, { itemId: 'item', quantity: 1, unitPriceCentavos: 90000, overrideReason: 'Bulk deal' });
    await expect(addQuotationServiceLine(db, id, { serviceId: 'service', rateCentavos: 1 })).rejects.toThrow(/reason/);
    expect((await getQuotation(db, id))?.lines).toMatchObject([{ priceSource: 'customer', unitPriceCentavos: 100000 }, { priceSource: 'override', unitPriceCentavos: 90000, overrideReason: 'Bulk deal' }]);
  });

  it('removes lines and deletes only drafts', async () => {
    const id = await createQuotationDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    await addQuotationServiceLine(db, id, { serviceId: 'service' });
    const [line] = (await getQuotation(db, id))!.lines;
    await removeQuotationLine(db, id, line.id);
    expect((await getQuotation(db, id))).toMatchObject({ totalCentavos: 0, lines: [] });
    await deleteQuotationDraft(db, id);
    expect(await getQuotation(db, id)).toBeNull();
  });

  it('finalizes with the next QT number and a frozen form, without touching stock', async () => {
    raw.prepare("INSERT INTO inventory_movements(id,item_id,movement_type,quantity_delta_integer,description,created_at) VALUES('opening','item','restock',10,'Opening','2026-09-05T00:00:00.000Z')").run();
    const id = await createQuotationDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    await expect(finalizeQuotation(db, id)).rejects.toThrow(/at least one/);
    await addQuotationItemLine(db, id, { itemId: 'item', quantity: 3 });
    const result = await finalizeQuotation(db, id);
    expect(result.qtNumber).toBe('QT-000001');
    expect(result.html).toContain('Quotation');
    expect(result.html).toContain('Valid until 2026-10-05');
    expect(result.html).not.toContain('Balance Due');
    expect(await getQuotation(db, id)).toMatchObject({ qtNumber: 'QT-000001', documentState: 'finalized', totalCentavos: 360000, pdfState: 'pending' });
    expect(stock()).toEqual({ stock: 10 });
    // Idempotent: finalizing again returns the stored result without a new number.
    expect((await finalizeQuotation(db, id)).qtNumber).toBe('QT-000001');
    expect(raw.prepare("SELECT high_water_mark FROM sequences WHERE name='QT'").get()).toEqual({ high_water_mark: 1 });
    await expect(addQuotationItemLine(db, id, { itemId: 'item', quantity: 1 })).rejects.toThrow(/draft quotation/);
  });

  it('voids a finalized quotation with a reason but never one that was converted', async () => {
    const id = await createQuotationDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    await addQuotationServiceLine(db, id, { serviceId: 'service' });
    await expect(voidQuotation(db, id, 'x')).rejects.toThrow(/finalized/);
    await finalizeQuotation(db, id);
    await expect(voidQuotation(db, id, '  ')).rejects.toThrow(/reason/);
    await voidQuotation(db, id, 'Customer cancelled');
    expect(await getQuotation(db, id)).toMatchObject({ documentState: 'voided' });

    const other = await createQuotationDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    await addQuotationServiceLine(db, other, { serviceId: 'service' });
    await finalizeQuotation(db, other);
    raw.prepare("UPDATE quotations SET converted_kind='delivery' WHERE id=?").run(other);
    await expect(voidQuotation(db, other, 'Too late')).rejects.toThrow(/converted/);
  });

  it('lists quotations newest first with searchable text', async () => {
    const first = await createQuotationDraft(db, { customerId: 'customer', businessDate: '2026-09-04' });
    await addQuotationItemLine(db, first, { itemId: 'item', quantity: 1 });
    await finalizeQuotation(db, first);
    await createQuotationDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    const list = await listQuotations(db);
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({ qtNumber: 'QT-000001', totalCentavos: 120000 });
    expect(list[1].searchText).toContain('detergent');
    expect(list[1].searchText).toContain('qt-000001');
  });
});

describe('quotation template', () => {
  it('shows quotation wording, the valid-until date and signature slots for both roles', () => {
    const html = buildQuotationHtml({
      qtNumber: 'QT-000007', businessDate: '2026-09-01', validUntil: '2026-09-30', fingerprint: 'AB12',
      business: { name: 'A.Ross', address: 'Addr', contactDetails: '0917' }, customer: { name: 'Quicklean <Co>', address: 'Somewhere' },
      lines: [{ description: 'Filter', quantity: 2, unitLabel: 'pc', unitPriceCentavos: 12500, amountCentavos: 25000 }],
      subtotalCentavos: 25000, discountLabel: null, discountCentavos: 0, totalCentavos: 25000, vatDisplayMode: 'disabled', vatRateBasisPoints: 1200,
    });
    expect(html).toContain('<h1 class="title">Quotation</h1>');
    expect(html).toContain('QT-000007');
    expect(html).toContain('Valid until 2026-09-30');
    expect(html).toContain('Quicklean &lt;Co&gt;');
    expect(html).toContain('data-signature-role="customer"');
    expect(html).toContain('data-signature-role="preparer"');
  });
});
