/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7, SCHEMA_V8, SCHEMA_V9, SCHEMA_V10 } from '@/db/schema';

let idCounter = 0;
vi.mock('expo-crypto', () => ({
  randomUUID: () => `v11-test-${++idCounter}`,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async () => 'ABCDEF1234567890',
}));

import { migrateDatabase } from '@/db/migrations';
import { addServiceLine, createBillingStatementDraft, getBillingStatement, listCsrsForBilling } from '@/features/billing-statements/billing-statement-repository';
import { formatMachineLabel } from '@/features/service-reports/machine-label';
import { getServiceReport, voidServiceReport } from '@/features/service-reports/service-report-repository';

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

const T = '2026-09-05T00:00:00.000Z';

/** A database exactly as the v10 app left it: one service priced once, billed at quantity 2. */
describe('upgrading a v10 database to per-machine service rows', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(async () => {
    idCounter = 0;
    raw = new DatabaseSync(':memory:');
    raw.exec(`PRAGMA foreign_keys=ON;${SCHEMA_V1}${SCHEMA_V2}${SCHEMA_V3}${SCHEMA_V4}${SCHEMA_V5}${SCHEMA_V6}${SCHEMA_V7}${SCHEMA_V8}${SCHEMA_V9}${SCHEMA_V10}PRAGMA user_version = 10;`);
    raw.exec("INSERT INTO app_meta(key,value) VALUES('database_revision','5')");
    raw.exec("INSERT INTO sequences(name,high_water_mark) VALUES('CSR',1),('BS',1),('PA',0)");
    raw.prepare("INSERT INTO settings(id,business_name,created_at,updated_at) VALUES('business','A.Ross',?,?)").run(T, T);
    raw.prepare("INSERT INTO customers(id,name,address,active,created_at,updated_at) VALUES('customer','Laundry','Sariaya',1,?,?)").run(T, T);
    const machine = raw.prepare('INSERT INTO customer_equipment(id,customer_id,machine_type,nickname_or_location,serial_number,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)');
    machine.run('washer', 'customer', 'Washer', '', 'SN-1', T, T);
    machine.run('dryer', 'customer', 'Dryer', 'Back room', '', T, T);
    machine.run('press', 'customer', 'Press', '', '', T, T);
    raw.prepare("INSERT INTO services(id,name,base_rate_centavos,active,created_at,updated_at) VALUES('labor','Labor',50000,1,?,?)").run(T, T);

    // Finalized CSR on two machines, with its service billed on a finalized statement as one quantity-2 line.
    raw.prepare("INSERT INTO service_reports(id,csr_number,customer_id,equipment_id,document_state,service_outcome,business_date,total_bill_centavos,created_at,finalized_at) VALUES('csr','CSR-000001','customer','washer','finalized','completed','2026-09-01',100000,?,?)").run(T, T);
    raw.prepare("INSERT INTO service_report_equipment(service_report_id,equipment_id,position,created_at) VALUES('csr','washer',1,?),('csr','dryer',2,?)").run(T, T);
    raw.prepare("INSERT INTO service_report_service_usage(id,service_report_id,service_id,quantity_integer,resolved_rate_centavos,rate_source,description_snapshot,created_at) VALUES('usage','csr','labor',1,50000,'catalog','Labor',?)").run(T);
    raw.prepare("INSERT INTO billing_statements(id,bs_number,customer_id,service_report_id,document_state,business_date,subtotal_centavos,discounted_total_centavos,payment_choice,created_at,finalized_at) VALUES('bs','BS-000001','customer','csr','finalized','2026-09-01',100000,100000,'pay_later',?,?)").run(T, T);
    raw.prepare("INSERT INTO billing_statement_lines(id,billing_statement_id,line_type,source_csr_service_usage_id,service_id,description_snapshot,quantity_integer,unit_price_centavos,amount_centavos,price_source,created_at) VALUES('legacy-line','bs','service','usage','labor','Labor',2,50000,100000,'catalog',?)").run(T);

    // A draft CSR whose draft statement still holds the v10 quantity-2 line.
    raw.prepare("INSERT INTO service_reports(id,customer_id,equipment_id,document_state,service_outcome,business_date,total_bill_centavos,created_at) VALUES('draft-csr','customer','washer','draft','incomplete','2026-09-02',100000,?)").run(T);
    raw.prepare("INSERT INTO service_report_equipment(service_report_id,equipment_id,position,created_at) VALUES('draft-csr','washer',1,?),('draft-csr','dryer',2,?)").run(T, T);
    raw.prepare("INSERT INTO service_report_service_usage(id,service_report_id,service_id,quantity_integer,resolved_rate_centavos,rate_source,description_snapshot,created_at) VALUES('draft-usage','draft-csr','labor',1,50000,'catalog','Labor',?)").run(T);
    raw.prepare("INSERT INTO billing_statements(id,customer_id,service_report_id,document_state,business_date,subtotal_centavos,discounted_total_centavos,created_at) VALUES('draft-bs','customer','draft-csr','draft','2026-09-02',100000,100000,?)").run(T);
    raw.prepare("INSERT INTO billing_statement_lines(id,billing_statement_id,line_type,source_csr_service_usage_id,service_id,description_snapshot,quantity_integer,unit_price_centavos,amount_centavos,price_source,created_at) VALUES('draft-legacy-line','draft-bs','service','draft-usage','labor','Labor',2,50000,100000,'catalog',?)").run(T);

    db = adapter(raw);
    await migrateDatabase(db);
  });

  afterEach(() => raw.close());

  it('moves to version 11 and gives each machine its own row at the old rate', () => {
    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 11 });
    const rows = raw.prepare("SELECT equipment_id, rate_centavos, machine_label, legacy_service_usage_id FROM service_report_machine_service WHERE service_report_id='csr' ORDER BY equipment_id").all();
    expect(rows).toEqual([
      { equipment_id: 'dryer', rate_centavos: 50000, machine_label: 'Dryer · Back room', legacy_service_usage_id: 'usage' },
      { equipment_id: 'washer', rate_centavos: 50000, machine_label: 'Washer · SN SN-1', legacy_service_usage_id: 'usage' },
    ]);
  });

  it('writes the same machine label in SQL as the JavaScript formula', () => {
    // The backfill ran during the upgrade; compare its SQL label formula with the JS helper.
    const labels = raw.prepare("SELECT equipment_id, machine_label FROM service_report_machine_service WHERE service_report_id='csr'").all() as Array<{ equipment_id: string; machine_label: string }>;
    const expected = new Map([
      ['washer', formatMachineLabel({ machineType: 'Washer', nicknameOrLocation: '', serialNumber: 'SN-1' })],
      ['dryer', formatMachineLabel({ machineType: 'Dryer', nicknameOrLocation: 'Back room', serialNumber: '' })],
    ]);
    for (const row of labels) expect(row.machine_label).toBe(expected.get(row.equipment_id));
    expect(formatMachineLabel({ machineType: 'Press', nicknameOrLocation: '', serialNumber: '' })).toBe('Press');
  });

  it('keeps the finalized CSR total and does not let its already-billed service be billed again', async () => {
    expect((await getServiceReport(db, 'csr'))?.totalBillCentavos).toBe(100000);
    const available = await listCsrsForBilling(db, 'customer');
    expect(available.find((entry) => entry.id === 'csr')).toMatchObject({ availableLineCount: 0 });
    const second = await createBillingStatementDraft(db, { customerId: 'customer', serviceReportId: 'csr', businessDate: '2026-09-05' });
    expect((await getBillingStatement(db, second))?.lines).toHaveLength(0);
    await expect(addServiceLine(db, second, { serviceId: 'labor' })).rejects.toThrow(/already been included/);
  });

  it('still blocks voiding a CSR whose only billed charge is a service', async () => {
    await expect(voidServiceReport(db, 'csr', 'Mistake', [], false)).rejects.toThrow(/Void related Billing Statements/);
  });

  it('converts a draft statement\'s quantity-2 line into one line per machine with the same total', async () => {
    const statement = await getBillingStatement(db, 'draft-bs');
    expect(statement?.lines).toMatchObject([
      { lineType: 'service', quantity: 1, amountCentavos: 50000, description: 'Labor — Washer · SN SN-1' },
      { lineType: 'service', quantity: 1, amountCentavos: 50000, description: 'Labor — Dryer · Back room' },
    ]);
    expect(statement?.subtotalCentavos).toBe(100000);
    expect(statement?.discountedTotalCentavos).toBe(100000);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM billing_statement_lines WHERE id='draft-legacy-line'").get()).toEqual({ count: 0 });
  });
});
