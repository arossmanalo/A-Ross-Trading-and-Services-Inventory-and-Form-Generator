/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SCHEMA_V1 } from '@/db/schema';
import {
  auditEntityLabel,
  auditReportCsv,
  filterAuditReport,
  getAuditReport,
  validateAuditReportFilter,
} from '@/features/reports/audit-report';

describe('audit reporting', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(() => {
    raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_V1);
    db = {
      getAllAsync: async <T>(sql: string, ...params: Array<string | number | null>) => raw.prepare(sql).all(...params) as T[],
    } as unknown as SQLiteDatabase;

    const insert = raw.prepare('INSERT INTO audit_events(id,event_type,entity_type,entity_id,details_json,created_at) VALUES(?,?,?,?,?,?)');
    insert.run('old', 'item.created', 'item', 'item-1', '{}', '2026-08-31T23:59:00.000Z');
    insert.run('sku', 'item.created_duplicate_sku_override', 'item', 'item-2', '{"sku":"=LD-1","openingStock":5}', '2026-09-01T08:00:00.000Z');
    insert.run('void', 'payment.voided', 'payment', 'payment-1', '{"reason":"Wrong reference"}', '2026-09-02T09:00:00.000Z');
    insert.run('bad', 'settings.updated', 'settings', 'business', '{bad json', '2026-09-03T09:00:00.000Z');
  });

  afterEach(() => raw.close());

  it('filters audit rows by timestamp date and entity type', async () => {
    await expect(getAuditReport(db, { from: '2026-09-01', to: '2026-09-30', entityType: 'item' })).resolves.toMatchObject([
      { id: 'sku', eventType: 'item.created_duplicate_sku_override', detailsText: 'sku: =LD-1; openingStock: 5' },
    ]);
    expect(await getAuditReport(db, { from: '2026-09-01', to: '2026-09-30' })).toHaveLength(3);
  });

  it('searches loaded rows and exports details safely', async () => {
    const rows = await getAuditReport(db, { from: '2026-09-01', to: '2026-09-30' });
    expect(filterAuditReport(rows, 'wrong reference').map(row => row.id)).toEqual(['void']);
    expect(rows.find(row => row.id === 'bad')?.detailsText).toContain('unreadableDetails');
    const csv = auditReportCsv(rows);
    expect(csv).toContain('"sku: =LD-1; openingStock: 5"');
    expect(csv).toContain('"Settings"');
    expect(auditEntityLabel('customer_item_price')).toBe('Customer Item Price');
  });

  it('rejects invalid filters', () => {
    expect(() => validateAuditReportFilter({ from: '2026-02-30', to: '2026-03-01' })).toThrow(/valid dates/);
    expect(() => validateAuditReportFilter({ from: '2026-09-02', to: '2026-09-01' })).toThrow(/Start date/);
    expect(() => validateAuditReportFilter({ from: '2026-09-01', to: '2026-09-02', entityType: 'unknown' as never })).toThrow(/valid audit entity/);
  });
});
