/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEED_SEQUENCES_SQL, schemaSql } from '@/test-utils/schema';

let idCounter = 0;
vi.mock('expo-crypto', () => ({
  randomUUID: () => `qc-id-${++idCounter}`,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async () => 'ABCDEF1234567890',
}));
beforeEach(() => vi.useFakeTimers({ now: new Date('2026-09-05T12:00:00.000Z') }));
afterEach(() => vi.useRealTimers());

import { getBillingStatement } from '@/features/billing-statements/billing-statement-repository';
import { getDelivery, finalizeDelivery } from '@/features/deliveries/delivery-repository';
import { getServiceReport } from '@/features/service-reports/service-report-repository';
import { convertQuotation, mergeQuoteLines } from './quotation-conversion';
import { addQuotationItemLine, addQuotationServiceLine, createQuotationDraft, finalizeQuotation, getQuotation, updateQuotationDraft, voidQuotation } from './quotation-repository';

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

describe('quotation conversion', () => {
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
    raw.prepare("INSERT INTO customer_equipment(id,customer_id,machine_type,created_at,updated_at) VALUES('washer','customer','Washer',?,?)").run(now, now);
    raw.prepare("INSERT INTO customer_equipment(id,customer_id,machine_type,created_at,updated_at) VALUES('dryer','customer','Dryer',?,?)").run(now, now);
    raw.prepare("INSERT INTO items(id,name,unit_label,base_selling_price_centavos,active,created_at,updated_at) VALUES('item','Detergent','carboy',120000,1,?,?)").run(now, now);
    raw.prepare("INSERT INTO services(id,name,base_rate_centavos,active,created_at,updated_at) VALUES('service','Labor',50000,1,?,?)").run(now, now);
    raw.prepare("INSERT INTO inventory_movements(id,item_id,movement_type,quantity_delta_integer,description,created_at) VALUES('open','item','restock',10,'Opening',?)").run(now);
    db = adapter(raw);
  });
  afterEach(() => raw.close());

  const count = (table: string) => (raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const stock = () => (raw.prepare("SELECT COALESCE(SUM(quantity_delta_integer),0) AS s FROM inventory_movements WHERE item_id='item'").get() as { s: number }).s;

  async function quote(options: { items?: number; services?: boolean; discount?: boolean } = {}) {
    const id = await createQuotationDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    if (options.items) await addQuotationItemLine(db, id, { itemId: 'item', quantity: options.items, unitPriceCentavos: 100000, overrideReason: 'Bulk' });
    if (options.services) await addQuotationServiceLine(db, id, { serviceId: 'service' });
    if (options.discount) await updateQuotationDraft(db, id, { businessDate: '2026-09-05', validUntil: '2026-10-05', discountType: 'fixed', discountValue: 10000 });
    await finalizeQuotation(db, id);
    return id;
  }

  it('repair: creates a CSR draft with the quoted items and services plus a linked Billing Statement draft', async () => {
    const id = await quote({ items: 2, services: true, discount: true });
    const result = await convertQuotation(db, id, { kind: 'repair', equipmentIds: ['washer', 'dryer'] });
    expect(result.kind).toBe('repair');

    const report = await getServiceReport(db, result.documentId);
    expect(report).toMatchObject({ documentState: 'draft', machineCount: 2 });
    expect(report?.usages).toMatchObject([{ itemId: 'item', quantity: 2, resolvedSellingPriceCentavos: 100000, priceSource: 'override' }]);
    expect(report?.machineServices).toMatchObject([{ serviceId: 'service', equipmentId: 'washer', rateCentavos: 50000 }]);

    const statement = await getBillingStatement(db, result.billingStatementId);
    expect(statement).toMatchObject({ serviceReportId: result.documentId, deliveryId: null, documentState: 'draft', subtotalCentavos: 250000, discountedTotalCentavos: 240000 });
    expect(statement?.lines).toHaveLength(2);

    expect(await getQuotation(db, id)).toMatchObject({ convertedKind: 'repair', convertedServiceReportId: result.documentId, convertedBillingStatementId: result.billingStatementId });
    expect(stock()).toBe(10);
  });

  it('delivery: creates a delivery draft with the quoted items and a statement that also carries the quoted services', async () => {
    const id = await quote({ items: 3, services: true });
    const result = await convertQuotation(db, id, { kind: 'delivery' });
    expect(result.kind).toBe('delivery');

    const delivery = await getDelivery(db, result.documentId);
    expect(delivery).toMatchObject({ documentState: 'draft', totalCentavos: 300000, linkedStatements: [{ id: result.billingStatementId }] });
    expect(delivery?.lines).toMatchObject([{ itemId: 'item', quantity: 3, unitPriceCentavos: 100000, priceSource: 'override' }]);

    const statement = await getBillingStatement(db, result.billingStatementId);
    expect(statement).toMatchObject({ deliveryId: result.documentId, serviceReportId: null, subtotalCentavos: 350000 });
    expect(statement?.lines.map((line) => line.lineType).sort()).toEqual(['item', 'service']);
    expect(await getQuotation(db, id)).toMatchObject({ convertedKind: 'delivery', convertedDeliveryId: result.documentId, convertedBillingStatementId: result.billingStatementId });
    expect(stock()).toBe(10); // stock moves only when the delivery is finalized
    await finalizeDelivery(db, result.documentId);
    expect(stock()).toBe(7);
  });

  it('converts once, and a converted quotation cannot be voided', async () => {
    const id = await quote({ items: 1 });
    await convertQuotation(db, id, { kind: 'delivery' });
    await expect(convertQuotation(db, id, { kind: 'delivery' })).rejects.toThrow(/already been converted/);
    await expect(convertQuotation(db, id, { kind: 'repair', equipmentIds: ['washer'] })).rejects.toThrow(/already been converted/);
    await expect(voidQuotation(db, id, 'Too late')).rejects.toThrow(/converted/);
    expect(count('deliveries')).toBe(1);
  });

  it('only converts a finalized quotation, and a repair needs a machine', async () => {
    const draft = await createQuotationDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    await expect(convertQuotation(db, draft, { kind: 'delivery' })).rejects.toThrow(/finalized/);
    const id = await quote({ items: 1 });
    await expect(convertQuotation(db, id, { kind: 'repair', equipmentIds: [] })).rejects.toThrow(/at least one machine/);
    await expect(convertQuotation(db, id, { kind: 'repair', equipmentIds: ['nope'] })).rejects.toThrow();
  });

  it('refuses a delivery for a services-only quotation', async () => {
    const id = await quote({ services: true });
    await expect(convertQuotation(db, id, { kind: 'delivery' })).rejects.toThrow(/only services/);
    expect(count('deliveries')).toBe(0);
  });

  it('keeps nothing when a step fails part-way', async () => {
    const id = await quote({ items: 2, services: true });
    raw.prepare("UPDATE services SET active=0 WHERE id='service'").run();
    // The delivery and its statement are created first; the quoted service then cannot be added.
    await expect(convertQuotation(db, id, { kind: 'delivery' })).rejects.toThrow(/active service/);
    expect(count('deliveries')).toBe(0);
    expect(count('delivery_lines')).toBe(0);
    expect(count('billing_statements')).toBe(0);
    expect(count('billing_statement_lines')).toBe(0);
    expect(await getQuotation(db, id)).toMatchObject({ convertedKind: null, convertedDeliveryId: null });

    await expect(convertQuotation(db, id, { kind: 'repair', equipmentIds: ['washer'] })).rejects.toThrow(/active service/);
    expect(count('service_reports')).toBe(0);
    expect(count('billing_statements')).toBe(0);
    expect(raw.prepare("SELECT high_water_mark FROM sequences WHERE name='QT'").get()).toEqual({ high_water_mark: 1 });
  });
});

describe('mergeQuoteLines', () => {
  const item = (price: number, quantity: number) => ({ line_type: 'item' as const, item_id: 'i', service_id: null, description_snapshot: 'Filter', quantity_integer: quantity, unit_price_centavos: price });

  it('adds lines of one item at the same price and keeps services apart', () => {
    const merged = mergeQuoteLines([item(100, 2), item(100, 3), { line_type: 'service', item_id: null, service_id: 's', description_snapshot: 'Labor', quantity_integer: 1, unit_price_centavos: 500 }]);
    expect(merged.items).toEqual([{ itemId: 'i', name: 'Filter', quantity: 5, unitPriceCentavos: 100 }]);
    expect(merged.services).toEqual([{ serviceId: 's', name: 'Labor', rateCentavos: 500 }]);
  });

  it('refuses one item at two prices', () => {
    expect(() => mergeQuoteLines([item(100, 1), item(120, 1)])).toThrow(/two different prices/);
  });
});
