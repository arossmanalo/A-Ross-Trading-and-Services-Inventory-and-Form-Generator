/// <reference types="node" />

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { schemaSql } from '@/test-utils/schema';

vi.mock('expo-crypto', () => ({
  randomUUID: () => 'recent-id',
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async () => 'checksum',
}));

import { listRecentCustomers } from '@/features/customers/customer-repository';

const T = '2026-11-01T08:00:00Z';

describe('recent customers', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(() => {
    raw = new DatabaseSync(':memory:');
    raw.exec(schemaSql());
    db = {
      getAllAsync: async <Row>(sql: string, ...params: SQLInputValue[]) => raw.prepare(sql).all(...params) as Row[],
    } as unknown as SQLiteDatabase;
    const customer = raw.prepare('INSERT INTO customers(id,name,active,created_at,updated_at) VALUES(?,?,?,?,?)');
    customer.run('old', 'Old Laundry', 1, T, T);
    customer.run('new', 'New Laundry', 1, T, T);
    customer.run('quiet', 'Quiet Laundry', 1, T, T);
    customer.run('closed', 'Closed Laundry', 0, T, T);
    customer.run('voided-only', 'Voided Laundry', 1, T, T);
    raw.exec(`INSERT INTO customer_equipment(id,customer_id,machine_type,active,created_at,updated_at)
      VALUES('washer','old','Washer',1,'${T}','${T}');`);
  });

  afterEach(() => raw.close());

  it('orders active customers by their newest non-voided document', async () => {
    raw.prepare(`INSERT INTO service_reports(id,customer_id,equipment_id,document_state,business_date,created_at) VALUES
      ('csr-1','old','washer','finalized','2026-10-01',?)`).run(T);
    raw.prepare(`INSERT INTO quotations(id,customer_id,document_state,business_date,valid_until,created_at) VALUES
      ('qt-1','old','draft','2026-11-03','2026-12-03',?)`).run(T);
    raw.prepare(`INSERT INTO deliveries(id,customer_id,document_state,business_date,created_at) VALUES
      ('df-1','new','finalized','2026-11-05',?),
      ('df-2','closed','finalized','2026-11-09',?)`).run(T, T);
    raw.prepare(`INSERT INTO billing_statements(id,customer_id,document_state,business_date,created_at) VALUES
      ('bs-1','voided-only','voided','2026-11-10',?)`).run(T);

    await expect(listRecentCustomers(db, 5)).resolves.toEqual([
      { id: 'new', name: 'New Laundry', lastActivityDate: '2026-11-05' },
      { id: 'old', name: 'Old Laundry', lastActivityDate: '2026-11-03' },
    ]);
    await expect(listRecentCustomers(db, 1)).resolves.toHaveLength(1);
  });
});
