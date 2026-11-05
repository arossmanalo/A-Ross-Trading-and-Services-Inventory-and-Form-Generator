/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { schemaSql } from '@/test-utils/schema';
import { resolveShareFileName } from './share-file-name';

describe('shared PDF file names from records', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(() => {
    raw = new DatabaseSync(':memory:');
    raw.exec(schemaSql());
    db = {
      getFirstAsync: async <T>(sql: string, ...params: Array<string | number | null>) => raw.prepare(sql).get(...params) as T | undefined,
    } as unknown as SQLiteDatabase;
    raw.exec(`
      INSERT INTO customers(id,name,created_at,updated_at) VALUES('c','Laundry Now','now','now');
      INSERT INTO customer_equipment(id,customer_id,machine_type,created_at,updated_at) VALUES('e','c','Washer','now','now');
      INSERT INTO service_reports(id,csr_number,customer_id,equipment_id,document_state,business_date,created_at)
        VALUES('csr','CSR-000012','c','e','finalized','2026-09-01','now'),
              ('draft-csr',NULL,'c','e','draft','2026-09-03','now');
      INSERT INTO billing_statements(id,bs_number,customer_id,service_report_id,document_state,business_date,created_at)
        VALUES('bs-linked','BS-000045','c','csr','finalized','2026-09-02','now'),
              ('bs-alone','BS-000046','c',NULL,'finalized','2026-09-04','now'),
              ('bs-draft-csr','BS-000047','c','draft-csr','finalized','2026-09-05','now');
      INSERT INTO payments(id,pa_number,billing_statement_id,amount_centavos,business_date,method,state,created_at,finalized_at)
        VALUES('pa','PA-000008','bs-alone',100,'2026-09-06','cash','active','now','now');
    `);
  });

  afterEach(() => raw.close());

  it('names a CSR by customer, code and its date; an unnumbered draft is DRAFT', async () => {
    expect(await resolveShareFileName(db, 'service_report', 'csr')).toBe('Laundry Now CSR-000012 2026-09-01.pdf');
    expect(await resolveShareFileName(db, 'service_report', 'draft-csr')).toBe('Laundry Now DRAFT 2026-09-03.pdf');
  });

  it('uses the frozen customer name once a document is finalized', async () => {
    raw.prepare('UPDATE service_reports SET content_snapshot_json=? WHERE id=?').run(JSON.stringify({ customer: { name: 'Old Name Co' } }), 'csr');
    raw.exec("UPDATE customers SET name='Renamed Co'");
    expect(await resolveShareFileName(db, 'service_report', 'csr')).toBe('Old Name Co CSR-000012 2026-09-01.pdf');
    expect(await resolveShareFileName(db, 'service_report', 'draft-csr')).toBe('Renamed Co DRAFT 2026-09-03.pdf');
  });

  it('names a statement billed against a finalized CSR like the CSR, since they are sent as one PDF', async () => {
    expect(await resolveShareFileName(db, 'billing_statement', 'bs-linked')).toBe('Laundry Now CSR-000012 2026-09-01.pdf');
  });

  it('names a standalone statement, or one whose CSR is not finalized, by its own code and date', async () => {
    expect(await resolveShareFileName(db, 'billing_statement', 'bs-alone')).toBe('Laundry Now BS-000046 2026-09-04.pdf');
    expect(await resolveShareFileName(db, 'billing_statement', 'bs-draft-csr')).toBe('Laundry Now BS-000047 2026-09-05.pdf');
  });

  it('names a payment acknowledgment by its own code and date, and applies variants', async () => {
    expect(await resolveShareFileName(db, 'payment', 'pa')).toBe('Laundry Now PA-000008 2026-09-06.pdf');
    expect(await resolveShareFileName(db, 'service_report', 'csr', 'Signed 2')).toBe('Laundry Now CSR-000012 2026-09-01 Signed 2.pdf');
  });

  it('rejects an unknown record', async () => {
    await expect(resolveShareFileName(db, 'billing_statement', 'missing')).rejects.toThrow(/not found/);
  });
});
