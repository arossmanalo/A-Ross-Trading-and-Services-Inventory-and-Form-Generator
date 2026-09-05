/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SCHEMA_V1 } from '@/db/schema';
import type { InventoryItemSummary } from '@/features/inventory/inventory-types';
import {
  filterMovementReport,
  filterStockReport,
  getInventoryMovementReport,
  movementReportCsv,
  stockReportCsv,
  validateMovementReportFilter,
} from '@/features/reports/inventory-report';

const item: InventoryItemSummary = {
  id: 'a',
  name: 'Bearing',
  sku: 'BR-1',
  unitLabel: 'pc',
  baseSellingPriceCentavos: 15025,
  lowStockThreshold: 2,
  currentStock: 2,
  active: true,
};

describe('stock reporting', () => {
  it('excludes inactive items from low stock and supports case-insensitive SKU search', () => {
    const inactive = { ...item, id: 'b', active: false };
    expect(filterStockReport([item, inactive], 'br-1', 'low')).toEqual([item]);
    expect(filterStockReport([item, inactive], '', 'inactive')).toEqual([inactive]);
    expect(filterStockReport([item], 'missing', 'all')).toEqual([]);
  });

  it('exports integer quantities, PHP prices, and protected spreadsheet cells', () => {
    const csv = stockReportCsv([{ ...item, name: '=malicious', active: false }]);
    expect(csv).toContain('"\'=malicious"');
    expect(csv).toContain('"2","2","Inactive","No","150.25"');
  });
});

describe('movement reporting', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(() => {
    raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_V1);
    db = {
      getAllAsync: async <T>(sql: string, ...params: Array<string | number | null>) => raw.prepare(sql).all(...params) as T[],
    } as unknown as SQLiteDatabase;

    raw.exec("INSERT INTO customers(id,name,created_at,updated_at) VALUES('customer','Laundry','now','now');");
    raw.exec("INSERT INTO customer_equipment(id,customer_id,machine_type,created_at,updated_at) VALUES('equipment','customer','Washer','now','now');");
    raw.exec("INSERT INTO items(id,name,sku,unit_label,base_selling_price_centavos,active,created_at,updated_at) VALUES('item','Liquid Detergent','LD-1','carboy',120000,1,'now','now'),('other','Fabcon','FB-1','gallon',97500,1,'now','now');");
    raw.exec("INSERT INTO service_reports(id,csr_number,customer_id,equipment_id,document_state,service_outcome,business_date,created_at) VALUES('csr','CSR-000001','customer','equipment','finalized','completed','2026-09-04','now');");
    raw.exec("INSERT INTO billing_statements(id,bs_number,customer_id,document_state,business_date,created_at) VALUES('bs','BS-000001','customer','finalized','2026-09-05','now');");
    const movement = raw.prepare('INSERT INTO inventory_movements(id,item_id,movement_type,quantity_delta_integer,service_report_id,billing_statement_id,description,created_at) VALUES(?,?,?,?,?,?,?,?)');
    movement.run('old', 'item', 'restock', 10, null, null, 'Opening stock', '2026-08-31T23:59:00.000Z');
    movement.run('sale', 'item', 'sale', -2, 'csr', 'bs', 'CSR billing sale', '2026-09-05T09:00:00.000Z');
    movement.run('nonbillable', 'item', 'nonbillable_usage', -1, 'csr', null, 'Training use', '2026-09-05T10:00:00.000Z');
    movement.run('other-item', 'other', 'restock', 5, null, null, '=Imported batch', '2026-09-05T11:00:00.000Z');
  });

  afterEach(() => raw.close());

  it('filters movement rows by date range, item, and movement type', async () => {
    await expect(getInventoryMovementReport(db, { from: '2026-09-05', to: '2026-09-05', itemId: 'item', movementType: 'sale' })).resolves.toMatchObject([
      { id: 'sale', itemName: 'Liquid Detergent', movementType: 'sale', quantityDelta: -2, serviceReportNumber: 'CSR-000001', billingStatementNumber: 'BS-000001' },
    ]);
    expect(await getInventoryMovementReport(db, { from: '2026-09-01', to: '2026-09-30' })).toHaveLength(3);
  });

  it('searches loaded rows and exports spreadsheet-safe movement CSV', async () => {
    const rows = await getInventoryMovementReport(db, { from: '2026-09-01', to: '2026-09-30' });
    expect(filterMovementReport(rows, 'csr-000001').map(row => row.id).sort()).toEqual(['nonbillable', 'sale']);
    const csv = movementReportCsv(rows);
    expect(csv).toContain('"Non-billable use"');
    expect(csv).toContain('"\'=Imported batch"');
    expect(() => validateMovementReportFilter({ from: '2026-09-31', to: '2026-10-01' })).toThrow(/valid dates/);
  });
});
