/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7, SCHEMA_V8, SCHEMA_V9, SCHEMA_V10, SCHEMA_V11 } from '@/db/schema';

let idCounter = 0;
vi.mock('expo-crypto', () => ({
  randomUUID: () => `ms-test-${++idCounter}`,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async () => 'ABCDEF1234567890',
}));

import { createBillingStatementDraft, finalizeBillingStatement, getBillingStatement } from '@/features/billing-statements/billing-statement-repository';
import {
  addMachineService,
  addReportItemUsage,
  createServiceReportDraft,
  finalizeServiceReport,
  getServiceReport,
  removeMachineService,
  updateMachineService,
} from '@/features/service-reports/service-report-repository';

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

const NOW = '2026-09-05T00:00:00.000Z';
const DRAFT = { customerId: 'customer', businessDate: '2026-09-05' };
const MACHINES = ['m1', 'm2', 'm3', 'm4', 'm5'];

describe('per-machine service prices stay accurate on the CSR and its billing statement', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(() => {
    idCounter = 0;
    vi.useFakeTimers({ now: new Date('2026-09-05T12:00:00.000Z') });
    raw = new DatabaseSync(':memory:');
    raw.exec(`PRAGMA foreign_keys=ON;${SCHEMA_V1}${SCHEMA_V2}${SCHEMA_V3}${SCHEMA_V4}${SCHEMA_V5}${SCHEMA_V6}${SCHEMA_V7}${SCHEMA_V8}${SCHEMA_V9}${SCHEMA_V10}${SCHEMA_V11}`);
    raw.exec("INSERT INTO app_meta(key,value) VALUES('database_revision','0')");
    raw.exec("INSERT INTO sequences(name,high_water_mark) VALUES('CSR',0),('BS',0),('PA',0)");
    raw.prepare("INSERT INTO settings(id,business_name,created_at,updated_at) VALUES('business','A.Ross',?,?)").run(NOW, NOW);
    raw.prepare("INSERT INTO customers(id,name,active,created_at,updated_at) VALUES('customer','Laundry',1,?,?)").run(NOW, NOW);
    const machine = raw.prepare("INSERT INTO customer_equipment(id,customer_id,machine_type,nickname_or_location,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)");
    for (const [index, id] of MACHINES.entries()) machine.run(id, 'customer', 'Washer', `Unit ${index + 1}`, NOW, NOW);
    raw.prepare("INSERT INTO items(id,name,unit_label,base_selling_price_centavos,active,created_at,updated_at) VALUES('item','Detergent','carboy',120000,1,?,?)").run(NOW, NOW);
    raw.prepare("INSERT INTO inventory_movements(id,item_id,movement_type,quantity_delta_integer,description,created_at) VALUES('opening','item','restock',10,'Opening',?)").run(NOW);
    raw.prepare("INSERT INTO services(id,name,base_rate_centavos,active,created_at,updated_at) VALUES('labor','Labor',200000,1,?,?),('cleaning','Cleaning',0,1,?,?)").run(NOW, NOW, NOW, NOW);
    db = adapter(raw);
  });

  afterEach(() => {
    raw.close();
    vi.useRealTimers();
  });

  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

  it('five machines at different prices: the CSR, its PDF snapshot, the statement lines and the statement all agree', async () => {
    const reportId = await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'm1', additionalEquipmentIds: MACHINES.slice(1) });
    await addReportItemUsage(db, reportId, 'item', 1, true);
    const statementId = await createBillingStatementDraft(db, { ...DRAFT, serviceReportId: reportId });

    // Labor: 2k, 2k, 1k, 4k, 4k. Cleaning (no catalog price) on only two machines. Labor repeated on one machine.
    await addMachineService(db, reportId, { equipmentId: 'm1', serviceId: 'labor', rateCentavos: 200000, alsoEquipmentIds: ['m2'] });
    const m3Labor = await addMachineService(db, reportId, { equipmentId: 'm3', serviceId: 'labor', rateCentavos: 100000 });
    await addMachineService(db, reportId, { equipmentId: 'm4', serviceId: 'labor', rateCentavos: 400000, alsoEquipmentIds: ['m5'] });
    await addMachineService(db, reportId, { equipmentId: 'm1', serviceId: 'cleaning', rateCentavos: 150000 });
    await addMachineService(db, reportId, { equipmentId: 'm3', serviceId: 'cleaning', rateCentavos: 75000 });
    const repeat = await addMachineService(db, reportId, { equipmentId: 'm1', serviceId: 'labor', rateCentavos: 25000, note: 'Return visit' });

    const services = 200000 + 200000 + 100000 + 400000 + 400000 + 150000 + 75000 + 25000;
    expect((await getServiceReport(db, reportId))?.totalBillCentavos).toBe(120000 + services);
    let statement = await getBillingStatement(db, statementId);
    expect(statement?.lines).toHaveLength(1 + 8);
    expect(statement?.subtotalCentavos).toBe(120000 + services);

    // Edit one price (with a note) and remove the repeated job.
    await updateMachineService(db, reportId, m3Labor, { rateCentavos: 120000, note: 'Heavy duty' });
    await removeMachineService(db, reportId, repeat);
    const adjusted = 120000 + services - 100000 + 120000 - 25000;
    expect((await getServiceReport(db, reportId))?.totalBillCentavos).toBe(adjusted);
    statement = await getBillingStatement(db, statementId);
    expect(statement?.lines.find((line) => line.description.includes('Unit 3') && line.description.startsWith('Labor'))).toMatchObject({ amountCentavos: 120000, priceSource: 'override', overrideReason: 'Heavy duty' });
    expect(statement?.lines).toHaveLength(1 + 7);

    const csr = await finalizeServiceReport(db, reportId);
    expect(csr.snapshot.totalBillCentavos).toBe(adjusted);
    expect(csr.snapshot.services).toHaveLength(7);
    expect(sum(csr.snapshot.services!.map((service) => service.rateCentavos)) + 120000).toBe(adjusted);
    expect(csr.html).toContain('Machine 1: Washer · Unit 1');
    expect(csr.html).toContain('₱1,200.00');
    expect(csr.html.match(/Machine subtotal/g)).toHaveLength(5);

    const billed = await finalizeBillingStatement(db, statementId);
    expect(billed.snapshot.totalCentavos).toBe(csr.snapshot.totalBillCentavos);
    expect(sum(billed.snapshot.lines.map((line) => line.amountCentavos))).toBe(adjusted);
    expect(raw.prepare("SELECT SUM(quantity_delta_integer) AS stock FROM inventory_movements WHERE item_id='item'").get()).toEqual({ stock: 9 });
    expect(raw.prepare('SELECT COUNT(*) AS count FROM inventory_movements WHERE billing_statement_id=?').get(statementId)).toEqual({ count: 0 });

    await expect(updateMachineService(db, reportId, m3Labor, { rateCentavos: 1 })).rejects.toThrow(/draft CSR/);
    await expect(removeMachineService(db, reportId, m3Labor)).rejects.toThrow(/draft/);
  });

  it('prices a service on a subset of machines and allows a zero price', async () => {
    const reportId = await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'm1', additionalEquipmentIds: ['m2', 'm3'] });
    await addMachineService(db, reportId, { equipmentId: 'm2', serviceId: 'cleaning', rateCentavos: 0 });
    await addMachineService(db, reportId, { equipmentId: 'm3', serviceId: 'cleaning', rateCentavos: 90000 });
    expect((await getServiceReport(db, reportId))?.totalBillCentavos).toBe(90000);
    const detail = await getServiceReport(db, reportId);
    expect(detail?.machineServices.map((service) => [service.machineLabel, service.rateCentavos, service.rateSource])).toEqual([
      ['Washer · Unit 2', 0, 'catalog'],
      ['Washer · Unit 3', 90000, 'custom'],
    ]);
  });

  it('rejects a price for a machine that is not on the CSR, an inactive service, and a negative price', async () => {
    const reportId = await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'm1' });
    await expect(addMachineService(db, reportId, { equipmentId: 'm2', serviceId: 'labor', rateCentavos: 1000 })).rejects.toThrow(/not listed/);
    await expect(addMachineService(db, reportId, { equipmentId: 'm1', serviceId: 'labor', rateCentavos: -1 })).rejects.toThrow(/non-negative/);
    raw.exec("UPDATE services SET active=0 WHERE id='cleaning'");
    await expect(addMachineService(db, reportId, { equipmentId: 'm1', serviceId: 'cleaning', rateCentavos: 1000 })).rejects.toThrow(/active service/);
    await expect(addMachineService(db, reportId, { equipmentId: 'm1', serviceId: 'labor', rateCentavos: 1000, alsoEquipmentIds: ['m1'] })).rejects.toThrow(/only once/);
    expect(raw.prepare('SELECT COUNT(*) AS count FROM service_report_machine_service').get()).toEqual({ count: 0 });
  });
});
