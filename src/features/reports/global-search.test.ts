/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SCHEMA_V1 } from '@/db/schema';
import { searchAppRecords, searchResultKindLabel } from '@/features/reports/global-search';

describe('global search', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(() => {
    raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_V1);
    db = {
      getAllAsync: async <T>(sql: string, ...params: Array<string | number | null>) => raw.prepare(sql).all(...params) as T[],
    } as unknown as SQLiteDatabase;

    raw.exec("INSERT INTO customers(id,name,address,contact_number,email,active,created_at,updated_at) VALUES('customer','C & C Laundry','Lucban','0917','client@example.com',1,'2026-09-01','2026-09-02');");
    raw.exec("INSERT INTO customer_equipment(id,customer_id,machine_type,model,serial_number,nickname_or_location,notes,created_at,updated_at) VALUES('equipment','customer','Washer','SpeedQueen','SN-123','Back room','Needs inspection','2026-09-01','2026-09-03');");
    raw.exec("INSERT INTO items(id,name,sku,description,unit_label,base_selling_price_centavos,active,created_at,updated_at) VALUES('item','Liquid Detergent','LD%1','Blue soap','carboy',120000,1,'2026-09-01','2026-09-04');");
    raw.exec("INSERT INTO services(id,name,description,base_rate_centavos,active,created_at,updated_at) VALUES('service','Labor','Service rate',50000,1,'2026-09-01','2026-09-05');");
    raw.exec("INSERT INTO service_reports(id,csr_number,customer_id,equipment_id,document_state,service_outcome,business_date,created_at,finalized_at) VALUES('csr','CSR-000001','customer','equipment','finalized','completed','2026-09-06','2026-09-06','2026-09-06');");
    raw.exec("INSERT INTO billing_statements(id,bs_number,customer_id,document_state,business_date,created_at,finalized_at) VALUES('bs','BS-000001','customer','finalized','2026-09-07','2026-09-07','2026-09-07');");
    raw.exec("INSERT INTO payments(id,pa_number,billing_statement_id,amount_centavos,business_date,method,reference_number,state,created_at,finalized_at) VALUES('payment','PA-000001','bs',10000,'2026-09-08','e_wallet','GCASH-123','active','2026-09-08','2026-09-08');");
  });

  afterEach(() => raw.close());

  it('finds records across core app entities with route ids', async () => {
    const customerResults = await searchAppRecords(db, 'Laundry');
    expect(customerResults.map(result => result.kind)).toEqual(expect.arrayContaining(['customer', 'equipment', 'service_report', 'billing_statement', 'payment']));
    expect(customerResults.find(result => result.kind === 'equipment')?.routeId).toBe('customer');
    expect(customerResults.find(result => result.kind === 'payment')?.routeId).toBe('payment');

    await expect(searchAppRecords(db, 'LD%1')).resolves.toMatchObject([
      { kind: 'item', id: 'item', title: 'Liquid Detergent' },
    ]);
  });

  it('escapes wildcard searches and enforces a bounded limit', async () => {
    expect(await searchAppRecords(db, '%')).toHaveLength(1);
    expect(await searchAppRecords(db, '')).toEqual([]);
    await expect(searchAppRecords(db, 'Laundry', 201)).rejects.toThrow(/between 1 and 200/);
    expect(searchResultKindLabel('billing_statement')).toBe('Billing Statement');
  });
});
