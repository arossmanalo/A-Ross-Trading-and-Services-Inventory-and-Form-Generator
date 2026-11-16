/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { schemaSql } from '@/test-utils/schema';

vi.mock('expo-crypto', () => ({
  randomUUID: () => 'badge-id',
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async () => 'checksum',
}));

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file://documents/',
  EncodingType: { Base64: 'base64' },
}));

vi.mock('expo-sharing', () => ({
  isAvailableAsync: async () => true,
  shareAsync: async () => undefined,
}));

import { getMenuBadges, hidesSideMenu } from '@/features/navigation/menu-badges';

const T = '2026-11-01T08:00:00Z';

describe('side menu badges', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(() => {
    raw = new DatabaseSync(':memory:');
    raw.exec(schemaSql());
    db = {
      getFirstAsync: async <T>(sql: string) => raw.prepare(sql).get() as T | undefined,
      getAllAsync: async <T>(sql: string) => raw.prepare(sql).all() as T[],
    } as unknown as SQLiteDatabase;
    raw.exec("INSERT INTO app_meta(key,value) VALUES('database_revision','1');");
    raw.exec(`INSERT INTO customers(id,name,active,created_at,updated_at) VALUES('customer','Laundry',1,'${T}','${T}');`);
    raw.exec(`INSERT INTO customer_equipment(id,customer_id,machine_type,active,created_at,updated_at) VALUES('washer','customer','Washer',1,'${T}','${T}');`);
  });

  afterEach(() => raw.close());

  it('counts only drafts in each section', async () => {
    raw.prepare(`INSERT INTO service_reports(id,customer_id,equipment_id,document_state,business_date,created_at) VALUES
      ('csr-1','customer','washer','draft','2026-11-01',?),
      ('csr-2','customer','washer','draft','2026-11-01',?),
      ('csr-3','customer','washer','voided','2026-11-01',?)`).run(T, T, T);
    raw.prepare(`INSERT INTO quotations(id,customer_id,document_state,business_date,valid_until,created_at) VALUES
      ('qt-1','customer','draft','2026-11-01','2026-11-30',?)`).run(T);
    raw.prepare(`INSERT INTO billing_statements(id,customer_id,document_state,business_date,created_at) VALUES
      ('bs-1','customer','draft','2026-11-01',?),
      ('bs-2','customer','voided','2026-11-01',?)`).run(T, T);

    await expect(getMenuBadges(db)).resolves.toEqual({
      serviceReportDrafts: 2,
      quotationDrafts: 1,
      deliveryDrafts: 0,
      statementDrafts: 1,
      backupDue: false,
    });
  });

  it('hides the menu only on document previews and the drawing pad', () => {
    expect(hidesSideMenu('/service-reports/preview')).toBe(true);
    expect(hidesSideMenu('/billing-statements/preview')).toBe(true);
    expect(hidesSideMenu('/signatures/preview')).toBe(true);
    expect(hidesSideMenu('/signatures/capture')).toBe(true);
    expect(hidesSideMenu('/service-reports')).toBe(false);
    expect(hidesSideMenu('/service-reports/abc')).toBe(false);
    expect(hidesSideMenu('/signatures/manage')).toBe(false);
    expect(hidesSideMenu('/')).toBe(false);
  });
});
