/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SCHEMA_V1, SCHEMA_V4 } from '@/db/schema';
import {
  collectionsReportCsv,
  filterCollectionsReport,
  getCollectionsReport,
  methodLabel,
  sumActiveCollections,
  validateCollectionsReportFilter,
} from '@/features/reports/collections-report';

describe('collections reporting', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(() => {
    raw = new DatabaseSync(':memory:');
    raw.exec(`${SCHEMA_V1}${SCHEMA_V4}`);
    db = {
      getAllAsync: async <T>(sql: string, ...params: Array<string | number | null>) => raw.prepare(sql).all(...params) as T[],
    } as unknown as SQLiteDatabase;

    raw.exec("INSERT INTO customers(id,name,created_at,updated_at) VALUES('a','C & C Laundry','now','now'),('b','Blue Wash','now','now');");
    raw.exec("INSERT INTO billing_statements(id,bs_number,customer_id,document_state,business_date,created_at) VALUES('bs-a','BS-000001','a','finalized','2026-09-01','now'),('bs-b','BS-000002','b','finalized','2026-09-01','now');");
    const payment = raw.prepare("INSERT INTO payments(id,pa_number,billing_statement_id,amount_centavos,business_date,method,reference_number,note,state,payment_kind,created_at,finalized_at,void_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
    payment.run('cash', 'PA-000001', 'bs-a', 10000, '2026-09-05', 'cash', null, null, 'active', 'paid_in_full', '2026-09-05T09:00:00Z', '2026-09-05T09:00:00Z', null);
    payment.run('gcash', 'PA-000002', 'bs-a', 5000, '2026-09-06', 'e_wallet', '=GCASH-1', null, 'active', 'down_payment', '2026-09-06T09:00:00Z', '2026-09-06T09:00:00Z', null);
    payment.run('voided', 'PA-000003', 'bs-b', 7000, '2026-09-06', 'bank_transfer', 'BANK-1', null, 'voided', 'paid_in_full', '2026-09-06T10:00:00Z', '2026-09-06T10:00:00Z', 'Wrong customer');
  });

  afterEach(() => raw.close());

  it('filters collections by payment date, customer, state, and method', async () => {
    await expect(getCollectionsReport(db, { from: '2026-09-01', to: '2026-09-30', customerId: 'a', state: 'active', method: 'e_wallet' })).resolves.toMatchObject([
      { id: 'gcash', customerName: 'C & C Laundry', amountCentavos: 5000, referenceNumber: '=GCASH-1' },
    ]);
    expect(await getCollectionsReport(db, { from: '2026-09-01', to: '2026-09-30', state: 'voided' })).toHaveLength(1);
  });

  it('searches loaded rows, totals only active payments, and exports safely', async () => {
    const rows = await getCollectionsReport(db, { from: '2026-09-01', to: '2026-09-30', state: 'all' });
    expect(filterCollectionsReport(rows, 'wrong customer').map(row => row.id)).toEqual(['voided']);
    expect(sumActiveCollections(rows)).toBe(15000);
    const csv = collectionsReportCsv(rows);
    expect(csv).toContain('"\'=GCASH-1"');
    expect(csv).toContain('"70.00","Wrong customer"');
    expect(methodLabel('e_wallet')).toBe('GCash/e-wallet');
  });

  it('rejects invalid filters', () => {
    expect(() => validateCollectionsReportFilter({ from: '2026-02-30', to: '2026-03-01' })).toThrow(/valid dates/);
    expect(() => validateCollectionsReportFilter({ from: '2026-09-02', to: '2026-09-01' })).toThrow(/Start date/);
    expect(() => validateCollectionsReportFilter({ from: '2026-09-01', to: '2026-09-02', method: 'card' as never })).toThrow(/valid payment method/);
  });
});
