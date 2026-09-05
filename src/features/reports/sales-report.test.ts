/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SCHEMA_V1 } from '@/db/schema';
import {
  filterSalesReport,
  getSalesReport,
  lineTypeLabel,
  salesReportCsv,
  validateSalesReportFilter,
} from '@/features/reports/sales-report';

describe('sales reporting', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(() => {
    raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_V1);
    db = {
      getAllAsync: async <T>(sql: string, ...params: Array<string | number | null>) => raw.prepare(sql).all(...params) as T[],
    } as unknown as SQLiteDatabase;

    raw.exec("INSERT INTO customers(id,name,created_at,updated_at) VALUES('a','C & C Laundry','now','now'),('b','Blue Wash','now','now');");
    raw.exec("INSERT INTO customer_equipment(id,customer_id,machine_type,created_at,updated_at) VALUES('equipment','a','Washer','now','now');");
    raw.exec("INSERT INTO service_reports(id,csr_number,customer_id,equipment_id,document_state,service_outcome,business_date,created_at) VALUES('csr','CSR-000001','a','equipment','finalized','completed','2026-09-01','now');");
    raw.exec("INSERT INTO items(id,name,unit_label,base_selling_price_centavos,active,created_at,updated_at) VALUES('item','Detergent','carboy',120000,1,'now','now');");
    raw.exec("INSERT INTO service_report_item_usage(id,service_report_id,item_id,quantity_integer,billable,description_snapshot,created_at) VALUES('usage','csr','item',1,1,'Detergent','now');");
    raw.exec("INSERT INTO billing_statements(id,bs_number,customer_id,service_report_id,document_state,business_date,subtotal_centavos,discounted_total_centavos,created_at,finalized_at) VALUES('bs-a','BS-000001','a','csr','finalized','2026-09-05',180000,170000,'2026-09-05','2026-09-05'),('bs-b','BS-000002','b',null,'finalized','2026-09-06',90000,90000,'2026-09-06','2026-09-06'),('draft','BS-DRAFT','a',null,'draft','2026-09-07',99999,99999,'2026-09-07',null);");
    const line = raw.prepare('INSERT INTO billing_statement_lines(id,billing_statement_id,line_type,source_csr_usage_id,description_snapshot,quantity_integer,unit_price_centavos,amount_centavos,price_source,override_reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    line.run('item-line', 'bs-a', 'item', 'usage', 'Liquid Detergent', 1, 120000, 120000, 'customer', null, '2026-09-05T08:00:00Z');
    line.run('service-line', 'bs-a', 'service', null, 'Service labor', 1, 60000, 60000, 'override', 'Holiday callout', '2026-09-05T08:01:00Z');
    line.run('expense-line', 'bs-b', 'expense', null, '=Parking', 1, 90000, 90000, 'expense', null, '2026-09-06T08:00:00Z');
    line.run('draft-line', 'draft', 'service', null, 'Draft service', 1, 99999, 99999, 'catalog', null, '2026-09-07T08:00:00Z');
  });

  afterEach(() => raw.close());

  it('returns finalized sales lines by statement date, customer, and line type', async () => {
    await expect(getSalesReport(db, { from: '2026-09-01', to: '2026-09-30', customerId: 'a', lineType: 'service' })).resolves.toMatchObject([
      { id: 'service-line', billingStatementNumber: 'BS-000001', amountCentavos: 60000, statementDiscountCentavos: 10000, serviceReportNumber: 'CSR-000001' },
    ]);
    expect(await getSalesReport(db, { from: '2026-09-01', to: '2026-09-30' })).toHaveLength(3);
  });

  it('searches loaded rows and exports statement-level discount context', async () => {
    const rows = await getSalesReport(db, { from: '2026-09-01', to: '2026-09-30' });
    expect(filterSalesReport(rows, 'holiday').map(row => row.id)).toEqual(['service-line']);
    const csv = salesReportCsv(rows);
    expect(csv).toContain('"\'=Parking"');
    expect(csv).toContain('"Holiday callout"');
    expect(csv).toContain('"100.00","1700.00"');
    expect(lineTypeLabel('expense')).toBe('Expense');
  });

  it('rejects invalid filters', () => {
    expect(() => validateSalesReportFilter({ from: '2026-02-30', to: '2026-03-01' })).toThrow(/valid dates/);
    expect(() => validateSalesReportFilter({ from: '2026-09-02', to: '2026-09-01' })).toThrow(/Start date/);
    expect(() => validateSalesReportFilter({ from: '2026-09-01', to: '2026-09-02', lineType: 'labor' as never })).toThrow(/valid sales line/);
  });
});
