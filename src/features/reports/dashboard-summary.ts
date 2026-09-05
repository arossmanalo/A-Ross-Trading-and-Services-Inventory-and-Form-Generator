import type { SQLiteDatabase } from 'expo-sqlite';

export type DashboardSummary = {
  activeItems: number;
  lowStockItems: number;
  customers: number;
  recentActivity: DashboardActivity[];
};

export type DashboardActivity = {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  createdAt: string;
};

export async function getDashboardSummary(db: SQLiteDatabase): Promise<DashboardSummary> {
  const [items, lowStock, customers, recentActivity] = await Promise.all([
    db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM items WHERE active = 1'),
    db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM items i
       WHERE i.active = 1
         AND COALESCE((
           SELECT SUM(m.quantity_delta_integer)
           FROM inventory_movements m
           WHERE m.item_id = i.id
         ), 0) <= i.low_stock_threshold`,
    ),
    db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM customers WHERE active = 1'),
    db.getAllAsync<DashboardActivity>(
      `SELECT id,event_type AS eventType,entity_type AS entityType,entity_id AS entityId,created_at AS createdAt
       FROM audit_events
       ORDER BY created_at DESC, rowid DESC
       LIMIT 8`,
    ),
  ]);

  return {
    activeItems: items?.count ?? 0,
    lowStockItems: lowStock?.count ?? 0,
    customers: customers?.count ?? 0,
    recentActivity,
  };
}
