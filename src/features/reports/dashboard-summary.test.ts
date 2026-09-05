/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SCHEMA_V1 } from '@/db/schema';
import { getDashboardSummary } from '@/features/reports/dashboard-summary';

describe('dashboard summary', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(() => {
    raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_V1);
    db = {
      getFirstAsync: async <T>(sql: string) => raw.prepare(sql).get() as T | undefined,
      getAllAsync: async <T>(sql: string) => raw.prepare(sql).all() as T[],
    } as unknown as SQLiteDatabase;

    raw.exec("INSERT INTO customers(id,name,active,created_at,updated_at) VALUES('customer','Laundry',1,'now','now'),('old','Old Laundry',0,'now','now');");
    raw.exec("INSERT INTO items(id,name,unit_label,base_selling_price_centavos,low_stock_threshold,active,created_at,updated_at) VALUES('low','Low Item','pc',100,2,1,'now','now'),('inactive-low','Inactive Low','pc',100,2,0,'now','now'),('ok','OK Item','pc',100,1,1,'now','now');");
    raw.exec("INSERT INTO inventory_movements(id,item_id,movement_type,quantity_delta_integer,description,created_at) VALUES('low-stock','low','restock',2,'Opening','now'),('ok-stock','ok','restock',5,'Opening','now');");
    raw.exec("INSERT INTO audit_events(id,event_type,entity_type,entity_id,details_json,created_at) VALUES('a','item.created','item','low','{}','2026-09-01T08:00:00Z'),('b','customer.created','customer','customer','{}','2026-09-02T08:00:00Z');");
  });

  afterEach(() => raw.close());

  it('summarizes active records, low stock, and recent activity', async () => {
    await expect(getDashboardSummary(db)).resolves.toEqual({
      activeItems: 2,
      lowStockItems: 1,
      customers: 1,
      recentActivity: [
        { id: 'b', eventType: 'customer.created', entityType: 'customer', entityId: 'customer', createdAt: '2026-09-02T08:00:00Z' },
        { id: 'a', eventType: 'item.created', entityType: 'item', entityId: 'low', createdAt: '2026-09-01T08:00:00Z' },
      ],
    });
  });
});
