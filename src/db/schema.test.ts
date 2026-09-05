/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5 } from './schema';

describe('database schema', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA foreign_keys = ON; ${SCHEMA_V1} ${SCHEMA_V2} ${SCHEMA_V3} ${SCHEMA_V4} ${SCHEMA_V5}`);
  });

  afterEach(() => {
    db.close();
  });

  it('creates the complete v1 schema', () => {
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'")
      .get() as { count: number };

    expect(row.count).toBe(20);
  });

  it('allows duplicate customer names and equipment serial numbers', () => {
    const insertCustomer = db.prepare(
      `INSERT INTO customers
        (id, name, active, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?)`,
    );
    insertCustomer.run('customer-1', 'C & C Laundry', 'now', 'now');
    insertCustomer.run('customer-2', 'C & C Laundry', 'now', 'now');

    const insertEquipment = db.prepare(
      `INSERT INTO customer_equipment
        (id, customer_id, machine_type, serial_number, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    );
    insertEquipment.run('equipment-1', 'customer-1', 'Washer', 'SERIAL-1', 'now', 'now');
    insertEquipment.run('equipment-2', 'customer-1', 'Dryer', 'SERIAL-1', 'now', 'now');

    const customerCount = db.prepare('SELECT COUNT(*) AS count FROM customers').get() as { count: number };
    const equipmentCount = db.prepare('SELECT COUNT(*) AS count FROM customer_equipment').get() as { count: number };
    expect(customerCount.count).toBe(2);
    expect(equipmentCount.count).toBe(2);
  });

  it('blocks a movement that would make stock negative', () => {
    db.exec(`
      INSERT INTO items
        (id, name, unit_label, active, created_at, updated_at)
      VALUES ('item-1', 'Bearing', 'pc', 1, 'now', 'now');
      INSERT INTO inventory_movements
        (id, item_id, movement_type, quantity_delta_integer, description, created_at)
      VALUES ('movement-1', 'item-1', 'restock', 2, 'Opening stock', 'now');
    `);

    expect(() => {
      db.exec(`
        INSERT INTO inventory_movements
          (id, item_id, movement_type, quantity_delta_integer, description, created_at)
        VALUES ('movement-2', 'item-1', 'consumption', -3, 'Invalid use', 'now');
      `);
    }).toThrow(/INSUFFICIENT_STOCK/);
  });

  it('keeps customer prices versioned with only one active price per item', () => {
    db.exec(`
      INSERT INTO customers
        (id, name, active, created_at, updated_at)
      VALUES ('customer-1', 'C & C Laundry', 1, 'now', 'now');
      INSERT INTO items
        (id, name, unit_label, active, created_at, updated_at)
      VALUES ('item-1', 'Detergent', 'carboy', 1, 'now', 'now');
      INSERT INTO customer_item_prices
        (id, customer_id, item_id, selling_price_centavos, effective_from, created_at)
      VALUES ('price-1', 'customer-1', 'item-1', 120000, 'time-1', 'time-1');
    `);

    expect(() => {
      db.exec(`
        INSERT INTO customer_item_prices
          (id, customer_id, item_id, selling_price_centavos, effective_from, created_at)
        VALUES ('price-conflict', 'customer-1', 'item-1', 125000, 'time-2', 'time-2');
      `);
    }).toThrow();

    db.exec(`
      UPDATE customer_item_prices SET effective_to = 'time-2' WHERE id = 'price-1';
      INSERT INTO customer_item_prices
        (id, customer_id, item_id, selling_price_centavos, effective_from, created_at)
      VALUES ('price-2', 'customer-1', 'item-1', 125000, 'time-2', 'time-2');
    `);

    const versions = db
      .prepare('SELECT COUNT(*) AS count FROM customer_item_prices')
      .get() as { count: number };
    const active = db
      .prepare('SELECT COUNT(*) AS count FROM customer_item_prices WHERE effective_to IS NULL')
      .get() as { count: number };
    expect(versions.count).toBe(2);
    expect(active.count).toBe(1);
  });

  it('adds the CSR v2 snapshot fields and double-posting guards', () => {
    const columns = db.prepare("PRAGMA table_info('service_reports')").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['billing_json', 'total_bill_centavos', 'acknowledged_by_snapshot']),
    );

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        'service_report_usage_one_item',
        'stock_transactions_one_active_csr_usage',
        'document_attachments_one_generated_pdf',
      ]),
    );
  });

  it('adds the billing statement double-posting guard', () => {
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toContain('stock_transactions_one_active_statement_sale');
  });

  it('adds frozen payment-document fields and the active down-payment guard', () => {
    const columns = db.prepare("PRAGMA table_info('payments')").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'payment_kind', 'content_snapshot_json', 'render_template_snapshot',
      'template_version', 'pdf_state', 'share_state', 'idempotency_key',
    ]));
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>;
    expect(indexes.map((index) => index.name)).toEqual(expect.arrayContaining([
      'payments_one_active_down_payment', 'payments_idempotency_key_unique',
    ]));
  });
});
