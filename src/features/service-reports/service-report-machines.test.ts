/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7, SCHEMA_V8, SCHEMA_V9, SCHEMA_V10, SCHEMA_V11 } from '@/db/schema';

let idCounter = 0;
vi.mock('expo-crypto', () => ({
  randomUUID: () => `machine-test-${++idCounter}`,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async () => 'ABCDEF1234567890',
}));

import {
  addDirectItemLine,
  addServiceLine,
  createBillingStatementDraft,
  finalizeBillingStatement,
  getBillingStatement,
  removeBillingLine,
} from '@/features/billing-statements/billing-statement-repository';
import {
  addMachineService,
  addReportEquipment,
  addReportItemUsage,
  addReportServiceUsage,
  createServiceReportDraft,
  deleteServiceReportDraft,
  finalizeServiceReport,
  getServiceReport,
  listServiceReports,
  removeReportEquipment,
  voidServiceReport,
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

describe('CSRs with several machines', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(() => {
    idCounter = 0;
    vi.useFakeTimers({ now: new Date('2026-09-05T12:00:00.000Z') });
    raw = new DatabaseSync(':memory:');
    raw.exec(`PRAGMA foreign_keys=ON;${SCHEMA_V1}${SCHEMA_V2}${SCHEMA_V3}${SCHEMA_V4}${SCHEMA_V5}${SCHEMA_V6}${SCHEMA_V7}${SCHEMA_V8}${SCHEMA_V9}${SCHEMA_V10}${SCHEMA_V11}`);
    raw.exec("INSERT INTO app_meta(key,value) VALUES('database_revision','0')");
    raw.exec("INSERT INTO sequences(name,high_water_mark) VALUES('CSR',0),('BS',0),('PA',0)");
    raw.prepare("INSERT INTO settings(id,business_name,business_address,contact_details,owner_name,created_at,updated_at) VALUES('business','A.Ross','Quezon','0917','Owner',?,?)").run(NOW, NOW);
    raw.prepare("INSERT INTO customers(id,name,address,active,created_at,updated_at) VALUES('customer','Laundry','Sariaya',1,?,?),('other','Other',' ',1,?,?)").run(NOW, NOW, NOW, NOW);
    const machine = raw.prepare("INSERT INTO customer_equipment(id,customer_id,machine_type,model,serial_number,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)");
    machine.run('washer', 'customer', 'Washer', 'W-1', 'SN-W', 1, NOW, NOW);
    machine.run('dryer', 'customer', 'Dryer', 'D-1', 'SN-D', 1, NOW, NOW);
    machine.run('retired', 'customer', 'Press', '', '', 0, NOW, NOW);
    machine.run('spare', 'customer', 'Ironer', '', '', 1, NOW, NOW);
    machine.run('foreign', 'other', 'Washer', '', '', 1, NOW, NOW);
    raw.prepare("INSERT INTO items(id,name,unit_label,base_selling_price_centavos,active,created_at,updated_at) VALUES('item','Detergent','carboy',120000,1,?,?)").run(NOW, NOW);
    raw.prepare("INSERT INTO inventory_movements(id,item_id,movement_type,quantity_delta_integer,description,created_at) VALUES('opening','item','restock',10,'Opening',?)").run(NOW);
    raw.prepare("INSERT INTO services(id,name,base_rate_centavos,active,created_at,updated_at) VALUES('service','Labor',50000,1,?,?)").run(NOW, NOW);
    db = adapter(raw);
  });

  afterEach(() => {
    raw.close();
    vi.useRealTimers();
  });

  const stock = () => raw.prepare("SELECT SUM(quantity_delta_integer) AS stock FROM inventory_movements WHERE item_id='item'").get();

  it('totals every per-machine service price, and item charges are not multiplied', async () => {
    const reportId = await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'washer', additionalEquipmentIds: ['dryer'] });
    await addReportItemUsage(db, reportId, 'item', 2, true);
    await addReportServiceUsage(db, reportId, 'service');

    const report = await getServiceReport(db, reportId);
    expect(report?.machineCount).toBe(2);
    expect(report?.machines.map((machine) => machine.machineType)).toEqual(['Washer', 'Dryer']);
    expect(report?.totalBillCentavos).toBe(2 * 120000 + 2 * 50000);
    expect(raw.prepare('SELECT total_bill_centavos AS total FROM service_reports WHERE id=?').get(reportId)).toEqual({ total: 340000 });
  });

  it('keeps single-machine totals unchanged', async () => {
    const reportId = await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'washer' });
    await addReportServiceUsage(db, reportId, 'service');
    expect((await getServiceReport(db, reportId))?.totalBillCentavos).toBe(50000);
  });

  it('treats a legacy CSR with no join rows as one machine', async () => {
    const reportId = await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'washer' });
    await addReportServiceUsage(db, reportId, 'service');
    raw.prepare('DELETE FROM service_report_equipment WHERE service_report_id=?').run(reportId);
    const report = await getServiceReport(db, reportId);
    expect(report?.machineCount).toBe(1);
    expect(report?.machines).toMatchObject([{ equipmentId: 'washer' }]);
    expect(report?.totalBillCentavos).toBe(50000);
  });

  it('rejects duplicate, inactive, and other-customer machines without leaving a draft', async () => {
    await expect(createServiceReportDraft(db, { ...DRAFT, equipmentId: 'washer', additionalEquipmentIds: ['washer'] })).rejects.toThrow(/only once/);
    await expect(createServiceReportDraft(db, { ...DRAFT, equipmentId: 'washer', additionalEquipmentIds: ['retired'] })).rejects.toThrow(/must be active/);
    await expect(createServiceReportDraft(db, { ...DRAFT, equipmentId: 'washer', additionalEquipmentIds: ['foreign'] })).rejects.toThrow(/does not belong/);
    expect(raw.prepare('SELECT COUNT(*) AS count FROM service_reports').get()).toEqual({ count: 0 });
    expect(raw.prepare('SELECT COUNT(*) AS count FROM service_report_equipment').get()).toEqual({ count: 0 });
  });

  it('prices services per machine: a new machine starts with no services and a removed machine drops its prices', async () => {
    const reportId = await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'washer' });
    await addReportServiceUsage(db, reportId, 'service');
    const statementId = await createBillingStatementDraft(db, { ...DRAFT, serviceReportId: reportId });
    expect((await getBillingStatement(db, statementId))?.lines).toMatchObject([{ quantity: 1, amountCentavos: 50000 }]);

    await addReportEquipment(db, reportId, 'dryer');
    expect((await getServiceReport(db, reportId))?.totalBillCentavos).toBe(50000);
    expect((await getBillingStatement(db, statementId))?.lines).toHaveLength(1);
    await expect(addReportEquipment(db, reportId, 'dryer')).rejects.toThrow(/already listed/);

    await addMachineService(db, reportId, { equipmentId: 'dryer', serviceId: 'service', rateCentavos: 30000 });
    expect((await getServiceReport(db, reportId))?.totalBillCentavos).toBe(80000);
    expect(await getBillingStatement(db, statementId)).toMatchObject({
      subtotalCentavos: 80000,
      discountedTotalCentavos: 80000,
      lines: [
        { description: 'Labor — Washer · SN SN-W', quantity: 1, amountCentavos: 50000 },
        { description: 'Labor — Dryer · SN SN-D', quantity: 1, amountCentavos: 30000 },
      ],
    });

    await removeReportEquipment(db, reportId, 'washer');
    expect(raw.prepare('SELECT equipment_id FROM service_reports WHERE id=?').get(reportId)).toEqual({ equipment_id: 'dryer' });
    expect((await getServiceReport(db, reportId))?.totalBillCentavos).toBe(30000);
    expect((await getBillingStatement(db, statementId))?.lines).toMatchObject([{ description: 'Labor — Dryer · SN SN-D', amountCentavos: 30000 }]);
    await expect(removeReportEquipment(db, reportId, 'dryer')).rejects.toThrow(/at least one machine/);
  });

  it('freezes machines and per-machine prices at finalization and bills the statement without re-posting stock', async () => {
    const reportId = await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'washer', additionalEquipmentIds: ['dryer'] });
    await addReportItemUsage(db, reportId, 'item', 1, true);
    await addReportServiceUsage(db, reportId, 'service');
    const statementId = await createBillingStatementDraft(db, { ...DRAFT, serviceReportId: reportId });

    const csr = await finalizeServiceReport(db, reportId);
    expect(csr.snapshot.machineCount).toBe(2);
    expect(csr.snapshot.machines).toMatchObject([{ machineType: 'Washer', serialNumber: 'SN-W' }, { machineType: 'Dryer', serialNumber: 'SN-D' }]);
    expect(csr.snapshot.services).toMatchObject([
      { description: 'Labor', rateCentavos: 50000, machineNumber: 1 },
      { description: 'Labor', rateCentavos: 50000, machineNumber: 2 },
    ]);
    expect(csr.snapshot.totalBillCentavos).toBe(120000 + 100000);
    expect(csr.html).toContain('Machine 1 of 2');
    expect(csr.html).toContain('Machine 2 of 2');
    expect(csr.html).toContain('Machine subtotal');
    expect(stock()).toEqual({ stock: 9 });

    await expect(addReportEquipment(db, reportId, 'retired')).rejects.toThrow(/draft CSR/);
    await expect(removeReportEquipment(db, reportId, 'dryer')).rejects.toThrow(/draft CSR/);
    await expect(addMachineService(db, reportId, { equipmentId: 'washer', serviceId: 'service', rateCentavos: 1 })).rejects.toThrow(/draft CSR/);

    const statement = await finalizeBillingStatement(db, statementId);
    expect(statement.snapshot.totalCentavos).toBe(220000);
    expect(statement.snapshot.lines).toMatchObject([
      { description: 'Detergent', quantity: 1, amountCentavos: 120000 },
      { description: 'Labor — Washer · SN SN-W', quantity: 1, unitPriceCentavos: 50000, amountCentavos: 50000 },
      { description: 'Labor — Dryer · SN SN-D', quantity: 1, unitPriceCentavos: 50000, amountCentavos: 50000 },
    ]);
    expect(stock()).toEqual({ stock: 9 });
  });

  it('reattaches only the removed finalized CSR service line, at its frozen price', async () => {
    const reportId = await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'washer', additionalEquipmentIds: ['dryer'] });
    await addMachineService(db, reportId, { equipmentId: 'washer', serviceId: 'service', rateCentavos: 20000 });
    await addMachineService(db, reportId, { equipmentId: 'dryer', serviceId: 'service', rateCentavos: 40000 });
    const statementId = await createBillingStatementDraft(db, { ...DRAFT, serviceReportId: reportId });
    await finalizeServiceReport(db, reportId);

    const lines = (await getBillingStatement(db, statementId))!.lines;
    expect(lines.map((line) => line.amountCentavos)).toEqual([20000, 40000]);
    await removeBillingLine(db, statementId, lines[1].id);
    raw.exec("UPDATE services SET base_rate_centavos=90000 WHERE id='service'");
    await expect(addServiceLine(db, statementId, { serviceId: 'service', rateCentavos: 90000 })).rejects.toThrow(/cannot be repriced/);
    await addServiceLine(db, statementId, { serviceId: 'service' });
    expect((await getBillingStatement(db, statementId))?.lines.map((line) => line.amountCentavos)).toEqual([20000, 40000]);
    await expect(addServiceLine(db, statementId, { serviceId: 'service' })).rejects.toThrow(/already been included/);
    expect((await finalizeBillingStatement(db, statementId)).snapshot.totalCentavos).toBe(60000);
  });

  it('refuses a billing line whose price no longer matches its CSR service price', async () => {
    const reportId = await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'washer', additionalEquipmentIds: ['dryer'] });
    await addReportServiceUsage(db, reportId, 'service');
    const statementId = await createBillingStatementDraft(db, { ...DRAFT, serviceReportId: reportId });
    await finalizeServiceReport(db, reportId);
    raw.prepare('UPDATE billing_statement_lines SET unit_price_centavos=40000, amount_centavos=40000 WHERE billing_statement_id=? AND description_snapshot LIKE ?').run(statementId, '%SN-W');
    await expect(finalizeBillingStatement(db, statementId)).rejects.toThrow(/does not match/);
    expect(raw.prepare("SELECT high_water_mark FROM sequences WHERE name='BS'").get()).toEqual({ high_water_mark: 0 });
  });

  it('allows a follow-up on a subset of the original machines only', async () => {
    const reportId = await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'washer', additionalEquipmentIds: ['dryer'] });
    await finalizeServiceReport(db, reportId);

    const followUpId = await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'dryer', followsCsrId: reportId });
    expect((await getServiceReport(db, followUpId))?.machines).toMatchObject([{ equipmentId: 'dryer' }]);
    await expect(createServiceReportDraft(db, { ...DRAFT, equipmentId: 'spare', followsCsrId: reportId })).rejects.toThrow(/machines from the original CSR/);
  });

  it('copies the machine set to the replacement draft when a CSR is voided and reissued', async () => {
    const reportId = await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'washer', additionalEquipmentIds: ['dryer'] });
    await addReportServiceUsage(db, reportId, 'service');
    await finalizeServiceReport(db, reportId);

    const reissueId = await voidServiceReport(db, reportId, 'Wrong machines', [], true);
    expect(reissueId).toBeTruthy();
    const reissued = await getServiceReport(db, reissueId!);
    expect(reissued?.machines.map((machine) => machine.equipmentId)).toEqual(['washer', 'dryer']);
    expect(reissued?.documentState).toBe('draft');
  });

  it('deletes a draft that has several machines', async () => {
    const reportId = await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'washer', additionalEquipmentIds: ['dryer'] });
    await deleteServiceReportDraft(db, reportId);
    expect(raw.prepare('SELECT COUNT(*) AS count FROM service_report_equipment').get()).toEqual({ count: 0 });
    expect(raw.prepare('SELECT COUNT(*) AS count FROM service_reports').get()).toEqual({ count: 0 });
  });

  it('labels multi-machine CSRs in the list', async () => {
    await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'washer', additionalEquipmentIds: ['dryer'] });
    await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'dryer' });
    const names = (await listServiceReports(db)).map((report) => report.equipmentName).sort();
    expect(names).toEqual(['Dryer', 'Washer +1 more']);
  });

  it('does not multiply a standalone statement service', async () => {
    const statementId = await createBillingStatementDraft(db, DRAFT);
    await addServiceLine(db, statementId, { serviceId: 'service' });
    await addDirectItemLine(db, statementId, { itemId: 'item', quantity: 1 });
    expect((await getBillingStatement(db, statementId))?.lines.map((line) => line.amountCentavos)).toEqual([50000, 120000]);
  });
});
