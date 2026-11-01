/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SCHEMA_V1, SCHEMA_V4 } from '@/db/schema';
import { resolveShareFileName } from './share-file-name';

describe('shared PDF file names from records', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(() => {
    raw = new DatabaseSync(':memory:');
    raw.exec(`${SCHEMA_V1}${SCHEMA_V4}`);
    db = {
      getFirstAsync: async <T>(sql: string, ...params: Array<string | number | null>) => raw.prepare(sql).get(...params) as T | undefined,
    } as unknown as SQLiteDatabase;
    raw.exec(`
      INSERT INTO customers(id,name,created_at,updated_at) VALUES('c','Laundry','now','now');
      INSERT INTO customer_equipment(id,customer_id,machine_type,created_at,updated_at) VALUES('e','c','Washer','now','now');
      INSERT INTO service_reports(id,csr_number,customer_id,equipment_id,document_state,business_date,created_at)
        VALUES('csr','CSR-000012','c','e','finalized','2026-09-01','now'),('draft-csr',NULL,'c','e','draft','2026-09-01','now');
      INSERT INTO billing_statements(id,bs_number,customer_id,service_report_id,document_state,business_date,created_at)
        VALUES('bs-linked','BS-000045','c','csr','finalized','2026-09-01','now'),
              ('bs-alone','BS-000046','c',NULL,'finalized','2026-09-01','now');
      INSERT INTO payments(id,pa_number,billing_statement_id,amount_centavos,business_date,method,state,created_at,finalized_at)
        VALUES('pa-linked','PA-000007','bs-linked',100,'2026-09-01','cash','active','now','now'),
              ('pa-alone','PA-000008','bs-alone',100,'2026-09-01','cash','active','now','now');
    `);
  });

  afterEach(() => raw.close());

  it('names a CSR by its number and an unnumbered draft DRAFT', async () => {
    expect(await resolveShareFileName(db, 'service_report', 'csr')).toBe('CSR-000012 Customer Service Report.pdf');
    expect(await resolveShareFileName(db, 'service_report', 'draft-csr')).toBe('DRAFT Customer Service Report.pdf');
  });

  it('names a linked Billing Statement by its CSR number, and a standalone one by its own number', async () => {
    expect(await resolveShareFileName(db, 'billing_statement', 'bs-linked')).toBe('CSR-000012 Billing Statement.pdf');
    expect(await resolveShareFileName(db, 'billing_statement', 'bs-alone')).toBe('BS-000046 Billing Statement.pdf');
  });

  it('appends the statement number once a CSR has more than one statement', async () => {
    raw.exec("INSERT INTO billing_statements(id,bs_number,customer_id,service_report_id,document_state,business_date,created_at) VALUES('bs-second','BS-000050','c','csr','finalized','2026-09-02','now')");
    expect(await resolveShareFileName(db, 'billing_statement', 'bs-linked')).toBe('CSR-000012 Billing Statement BS-000045.pdf');
    expect(await resolveShareFileName(db, 'billing_statement', 'bs-second')).toBe('CSR-000012 Billing Statement BS-000050.pdf');
  });

  it('keeps payment acknowledgments distinct and applies variants', async () => {
    expect(await resolveShareFileName(db, 'payment', 'pa-linked')).toBe('CSR-000012 Payment Acknowledgment PA-000007.pdf');
    expect(await resolveShareFileName(db, 'payment', 'pa-alone')).toBe('PA-000008 Payment Acknowledgment.pdf');
    expect(await resolveShareFileName(db, 'service_report', 'csr', 'Signed 2')).toBe('CSR-000012 Customer Service Report Signed 2.pdf');
  });

  it('rejects an unknown record', async () => {
    await expect(resolveShareFileName(db, 'billing_statement', 'missing')).rejects.toThrow(/not found/);
  });
});
