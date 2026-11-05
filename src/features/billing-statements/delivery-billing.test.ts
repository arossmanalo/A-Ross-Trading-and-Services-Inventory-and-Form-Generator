/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEED_SEQUENCES_SQL, schemaSql } from '@/test-utils/schema';

let idCounter = 0;
vi.mock('expo-crypto', () => ({
  randomUUID: () => `db-id-${++idCounter}`,
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
  updateDeliveryLineQuantity,
  voidDelivery,
} from '@/features/deliveries/delivery-repository';
import {
  addDirectItemLine,
  addServiceLine,
  createBillingStatementDraft,
  finalizeBillingStatement,
  getBillingStatement,
  listBillingStatements,
  listDeliveriesForBilling,
  removeBillingLine,
  voidBillingStatement,
} from './billing-statement-repository';

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

describe('Billing Statement from a Delivery', () => {
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
    raw.prepare("INSERT INTO customers(id,name,address,active,created_at,updated_at) VALUES('other','Other Co','Lucena',1,?,?)").run(now, now);
    raw.prepare("INSERT INTO items(id,name,unit_label,base_selling_price_centavos,active,created_at,updated_at) VALUES('item','Detergent','carboy',120000,1,?,?)").run(now, now);
    raw.prepare("INSERT INTO items(id,name,unit_label,base_selling_price_centavos,active,created_at,updated_at) VALUES('softener','Softener','gal',80000,1,?,?)").run(now, now);
    raw.prepare("INSERT INTO services(id,name,base_rate_centavos,active,created_at,updated_at) VALUES('service','Labor',50000,1,?,?)").run(now, now);
    raw.prepare("INSERT INTO inventory_movements(id,item_id,movement_type,quantity_delta_integer,description,created_at) VALUES('open1','item','restock',10,'Opening',?)").run(now);
    raw.prepare("INSERT INTO inventory_movements(id,item_id,movement_type,quantity_delta_integer,description,created_at) VALUES('open2','softener','restock',10,'Opening',?)").run(now);
    db = adapter(raw);
  });
  afterEach(() => raw.close());

  const stockOf = (itemId: string) => (raw.prepare('SELECT COALESCE(SUM(quantity_delta_integer),0) AS stock FROM inventory_movements WHERE item_id=?').get(itemId) as { stock: number }).stock;

  async function finalizedDelivery(quantity = 4) {
    const id = await createDeliveryDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    await addDeliveryItemLine(db, id, { itemId: 'item', quantity });
    await finalizeDelivery(db, id);
    return id;
  }

  it('creates a statement that bills the delivered items, and finalizing it deducts no stock again', async () => {
    const deliveryId = await finalizedDelivery(4);
    expect(stockOf('item')).toBe(6);
    const statementId = await createBillingStatementDraft(db, { customerId: 'customer', deliveryId, businessDate: '2026-09-05' });
    const draft = await getBillingStatement(db, statementId);
    expect(draft).toMatchObject({ deliveryId, deliveryNumber: 'DF-000001', serviceReportId: null, discountedTotalCentavos: 480000, lines: [{ lineType: 'item', quantity: 4, unitPriceCentavos: 120000, amountCentavos: 480000 }] });
    expect(draft?.lines[0].sourceDeliveryLineId).not.toBeNull();

    const result = await finalizeBillingStatement(db, statementId);
    expect(result.bsNumber).toBe('BS-000001');
    expect(stockOf('item')).toBe(6); // the delivery already took it
    expect(raw.prepare("SELECT COUNT(*) AS n FROM stock_transactions WHERE billing_statement_id=?").get(statementId)).toEqual({ n: 0 });
    expect((await getDelivery(db, deliveryId))?.linkedStatements).toMatchObject([{ id: statementId, bsNumber: 'BS-000001', documentState: 'finalized', totalCentavos: 480000 }]);
  });

  it('allows one live statement per delivery, of the same customer, and never a CSR as well', async () => {
    const deliveryId = await finalizedDelivery();
    await expect(createBillingStatementDraft(db, { customerId: 'other', deliveryId, businessDate: '2026-09-05' })).rejects.toThrow(/same customer/);
    const statementId = await createBillingStatementDraft(db, { customerId: 'customer', deliveryId, businessDate: '2026-09-05' });
    await expect(createBillingStatementDraft(db, { customerId: 'customer', deliveryId, businessDate: '2026-09-05' })).rejects.toThrow(/already has a Billing Statement/);
    expect(await createBillingStatementDraft(db, { customerId: 'customer', deliveryId, businessDate: '2026-09-05', reuseExistingLinkedDraft: true })).toBe(statementId);
    await expect(createBillingStatementDraft(db, { customerId: 'customer', deliveryId, serviceReportId: 'csr', businessDate: '2026-09-05' })).rejects.toThrow(/not both/);
    expect(await listDeliveriesForBilling(db, 'customer')).toEqual([]);
    expect((await listBillingStatements(db))[0]).toMatchObject({ deliveryId, deliveryNumber: 'DF-000001' });
    expect((await listBillingStatements(db))[0].searchText).toContain('df-000001');
  });

  it('cannot remove delivered lines from the statement, but keeps its own service lines when the delivery changes', async () => {
    const deliveryId = await createDeliveryDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    await addDeliveryItemLine(db, deliveryId, { itemId: 'item', quantity: 2 });
    const statementId = await createBillingStatementDraft(db, { customerId: 'customer', deliveryId, businessDate: '2026-09-05' });
    await addServiceLine(db, statementId, { serviceId: 'service' });
    const [deliveryLine] = (await getDelivery(db, deliveryId))!.lines;

    await updateDeliveryLineQuantity(db, deliveryId, deliveryLine.id, 3);
    await addDeliveryItemLine(db, deliveryId, { itemId: 'softener', quantity: 1 });
    let statement = await getBillingStatement(db, statementId);
    expect(statement?.lines.map((line) => `${line.description}:${line.quantity}:${line.amountCentavos}`).sort()).toEqual(['Detergent:3:360000', 'Labor:1:50000', 'Softener:1:80000']);
    expect(statement?.discountedTotalCentavos).toBe(490000);

    const delivered = statement!.lines.find((line) => line.sourceDeliveryLineId);
    await expect(removeBillingLine(db, statementId, delivered!.id)).rejects.toThrow(/Change them on the delivery/);
    await removeDeliveryLine(db, deliveryId, deliveryLine.id);
    statement = await getBillingStatement(db, statementId);
    expect(statement?.lines.map((line) => line.description).sort()).toEqual(['Labor', 'Softener']);
    expect(statement?.discountedTotalCentavos).toBe(130000);
  });

  it('needs the delivery finalized first, and a deleted delivery draft takes its statement draft with it', async () => {
    const deliveryId = await createDeliveryDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    await addDeliveryItemLine(db, deliveryId, { itemId: 'item', quantity: 2 });
    const statementId = await createBillingStatementDraft(db, { customerId: 'customer', deliveryId, businessDate: '2026-09-05' });
    await expect(finalizeBillingStatement(db, statementId)).rejects.toThrow(/Finalize the linked delivery/);
    await finalizeDelivery(db, deliveryId);
    await expect(finalizeBillingStatement(db, statementId)).resolves.toMatchObject({ bsNumber: 'BS-000001' });

    const other = await createDeliveryDraft(db, { customerId: 'customer', businessDate: '2026-09-05' });
    await addDeliveryItemLine(db, other, { itemId: 'softener', quantity: 1 });
    const otherStatement = await createBillingStatementDraft(db, { customerId: 'customer', deliveryId: other, businessDate: '2026-09-05' });
    await deleteDeliveryDraft(db, other);
    expect(await getDelivery(db, other)).toBeNull();
    expect(await getBillingStatement(db, otherStatement)).toBeNull();
  });

  it('bills direct item lines on the same statement from stock exactly once', async () => {
    const deliveryId = await finalizedDelivery(4);
    const statementId = await createBillingStatementDraft(db, { customerId: 'customer', deliveryId, businessDate: '2026-09-05' });
    await addDirectItemLine(db, statementId, { itemId: 'softener', quantity: 2 });
    await finalizeBillingStatement(db, statementId);
    expect(stockOf('item')).toBe(6); // delivered line: not deducted again
    expect(stockOf('softener')).toBe(8); // direct line: deducted by the statement
    expect(raw.prepare("SELECT COUNT(*) AS n FROM stock_transactions WHERE billing_statement_id=? AND transaction_type='sale'").get(statementId)).toEqual({ n: 1 });
  });

  it('blocks voiding a billed delivery, and voiding the statement frees the delivery for a new one', async () => {
    const deliveryId = await finalizedDelivery(4);
    const statementId = await createBillingStatementDraft(db, { customerId: 'customer', deliveryId, businessDate: '2026-09-05' });
    await finalizeBillingStatement(db, statementId);
    await expect(voidDelivery(db, deliveryId, 'Mistake', [{ itemId: 'item', returnedToStock: true }])).rejects.toThrow(/BS-000001 first/);

    await voidBillingStatement(db, statementId, 'Wrong prices', []);
    expect(stockOf('item')).toBe(6); // voiding the statement never touches the delivery's stock
    expect(raw.prepare('SELECT COUNT(*) AS n FROM billing_statement_lines WHERE billing_statement_id=? AND source_delivery_line_id IS NOT NULL').get(statementId)).toEqual({ n: 0 });
    expect((await listDeliveriesForBilling(db, 'customer')).map((entry) => entry.id)).toEqual([deliveryId]);

    const replacement = await createBillingStatementDraft(db, { customerId: 'customer', deliveryId, businessDate: '2026-09-05' });
    expect(replacement).not.toBe(statementId);
    expect((await getBillingStatement(db, replacement))?.discountedTotalCentavos).toBe(480000);
    await finalizeBillingStatement(db, replacement);
    expect(raw.prepare("SELECT bs_number FROM billing_statements WHERE source_delivery_id=? AND document_state='finalized'").all(deliveryId)).toEqual([{ bs_number: 'BS-000002' }]);

    expect((await listDeliveries(db))[0].linkedStatements).toMatchObject([{ id: replacement, bsNumber: 'BS-000002' }]);
  });
});
