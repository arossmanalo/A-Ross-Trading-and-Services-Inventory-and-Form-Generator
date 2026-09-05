import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { assertPositiveIntegerQuantity } from '@/domain/stock';
import type {
  CreateInventoryItemInput,
  InventoryItemDetail,
  InventoryItemSummary,
  InventoryMovementInput,
  InventoryMovementSummary,
} from '@/features/inventory/inventory-types';

type InventoryItemRow = {
  id: string;
  name: string;
  sku: string | null;
  unit_label: string;
  base_selling_price_centavos: number;
  low_stock_threshold: number;
  current_stock: number;
  active: number;
};

type InventoryItemDetailRow = InventoryItemRow & {
  description: string;
};

type InventoryMovementRow = {
  id: string;
  movement_type: InventoryMovementSummary['movementType'];
  quantity_delta_integer: number;
  description: string;
  service_report_id: string | null;
  billing_statement_id: string | null;
  created_at: string;
};

export class DuplicateSkuError extends Error {
  constructor(readonly sku: string) {
    super(`SKU “${sku}” already exists. Confirm to save this item anyway.`);
    this.name = 'DuplicateSkuError';
  }
}

export class InsufficientStockError extends Error {
  constructor(readonly available: number, readonly requested: number) {
    super(`Only ${available} unit(s) are available; ${requested} requested.`);
    this.name = 'InsufficientStockError';
  }
}

export async function listInventoryItems(db: SQLiteDatabase): Promise<InventoryItemSummary[]> {
  const rows = await db.getAllAsync<InventoryItemRow>(
    `SELECT
       i.id,
       i.name,
       i.sku,
       i.unit_label,
       i.base_selling_price_centavos,
       i.low_stock_threshold,
       COALESCE(SUM(m.quantity_delta_integer), 0) AS current_stock,
       i.active
     FROM items i
     LEFT JOIN inventory_movements m ON m.item_id = i.id
     GROUP BY i.id
     ORDER BY i.active DESC, i.name COLLATE NOCASE ASC`,
  );

  return rows.map(mapInventoryItemRow);
}

export async function getCurrentStock(db: SQLiteDatabase, itemId: string): Promise<number> {
  const row = await db.getFirstAsync<{ current_stock: number }>(
    `SELECT COALESCE(SUM(quantity_delta_integer), 0) AS current_stock
     FROM inventory_movements
     WHERE item_id = ?`,
    itemId,
  );
  return row?.current_stock ?? 0;
}

export async function getInventoryItemDetail(
  db: SQLiteDatabase,
  itemId: string,
): Promise<InventoryItemDetail | null> {
  const row = await db.getFirstAsync<InventoryItemDetailRow>(
    `SELECT
       i.id,
       i.name,
       i.sku,
       i.description,
       i.unit_label,
       i.base_selling_price_centavos,
       i.low_stock_threshold,
       i.active,
       COALESCE(SUM(m.quantity_delta_integer), 0) AS current_stock
     FROM items i
     LEFT JOIN inventory_movements m ON m.item_id = i.id
     WHERE i.id = ?
     GROUP BY i.id`,
    itemId,
  );

  if (!row) return null;
  return { ...mapInventoryItemRow(row), description: row.description };
}

export async function listInventoryMovements(
  db: SQLiteDatabase,
  itemId: string,
): Promise<InventoryMovementSummary[]> {
  const rows = await db.getAllAsync<InventoryMovementRow>(
    `SELECT
       id,
       movement_type,
       quantity_delta_integer,
       description,
       service_report_id,
       billing_statement_id,
       created_at
     FROM inventory_movements
     WHERE item_id = ?
     ORDER BY created_at DESC, rowid DESC`,
    itemId,
  );

  return rows.map((row) => ({
    id: row.id,
    movementType: row.movement_type,
    quantityDelta: row.quantity_delta_integer,
    description: row.description,
    serviceReportId: row.service_report_id,
    billingStatementId: row.billing_statement_id,
    createdAt: row.created_at,
  }));
}

export async function createInventoryItemWithOpeningStock(
  db: SQLiteDatabase,
  input: CreateInventoryItemInput,
): Promise<string> {
  const name = input.name.trim();
  const sku = input.sku?.trim() || null;
  const unitLabel = input.unitLabel.trim();
  const description = input.description?.trim() ?? '';
  const openingDescription = input.openingStockDescription.trim();

  if (!name) throw new Error('Item name is required.');
  if (!unitLabel) throw new Error('Unit label is required.');
  assertNonNegativeInteger(input.baseSellingPriceCentavos, 'Selling price');
  assertNonNegativeInteger(input.lowStockThreshold, 'Low-stock threshold');
  assertNonNegativeInteger(input.openingStock, 'Opening stock');
  if (input.openingStock > 0 && !openingDescription) {
    throw new Error('Opening-stock description is required.');
  }

  const itemId = Crypto.randomUUID();
  const now = new Date().toISOString();
  let usedDuplicateSkuOverride = false;

  await db.withExclusiveTransactionAsync(async (tx) => {
    if (sku) {
      const duplicate = await tx.getFirstAsync<{ id: string }>(
        `SELECT id FROM items
         WHERE upper(trim(sku)) = upper(trim(?))
         LIMIT 1`,
        sku,
      );
      if (duplicate && !input.allowDuplicateSku) {
        throw new DuplicateSkuError(sku);
      }
      usedDuplicateSkuOverride = Boolean(duplicate && input.allowDuplicateSku);
    }

    await tx.runAsync(
      `INSERT INTO items
        (id, name, sku, description, unit_label, base_selling_price_centavos,
         low_stock_threshold, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      itemId,
      name,
      sku,
      description,
      unitLabel,
      input.baseSellingPriceCentavos,
      input.lowStockThreshold,
      now,
      now,
    );

    if (input.openingStock > 0) {
      await tx.runAsync(
        `INSERT INTO inventory_movements
          (id, item_id, movement_type, quantity_delta_integer, description, created_at)
         VALUES (?, ?, 'restock', ?, ?, ?)`,
        Crypto.randomUUID(),
        itemId,
        input.openingStock,
        openingDescription,
        now,
      );
    }

    await appendAuditEvent(tx, {
      eventType: usedDuplicateSkuOverride ? 'item.created_duplicate_sku_override' : 'item.created',
      entityType: 'item',
      entityId: itemId,
      details: { sku, openingStock: input.openingStock },
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });

  return itemId;
}

export async function restockInventoryItem(
  db: SQLiteDatabase,
  input: InventoryMovementInput,
): Promise<void> {
  await recordManualMovement(db, input, 'restock');
}

export async function consumeInventoryItem(
  db: SQLiteDatabase,
  input: InventoryMovementInput,
): Promise<void> {
  await recordManualMovement(db, input, 'consumption');
}

export async function setInventoryItemActive(
  db: SQLiteDatabase,
  itemId: string,
  active: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const result = await tx.runAsync(
      `UPDATE items
       SET active = ?, updated_at = ?
       WHERE id = ?`,
      active ? 1 : 0,
      now,
      itemId,
    );
    if (result.changes !== 1) throw new Error('Inventory item was not found.');

    await appendAuditEvent(tx, {
      eventType: active ? 'item.reactivated' : 'item.deactivated',
      entityType: 'item',
      entityId: itemId,
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });
}

async function recordManualMovement(
  db: SQLiteDatabase,
  input: InventoryMovementInput,
  movementType: 'consumption' | 'restock',
): Promise<void> {
  assertPositiveIntegerQuantity(input.quantity);
  const description = input.description.trim();
  if (!description) throw new Error('Movement description is required.');

  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const item = await tx.getFirstAsync<{ id: string }>(
      'SELECT id FROM items WHERE id = ?',
      input.itemId,
    );
    if (!item) throw new Error('Inventory item was not found.');

    if (movementType === 'consumption') {
      const available = await getCurrentStock(tx, input.itemId);
      if (input.quantity > available) {
        throw new InsufficientStockError(available, input.quantity);
      }
    }

    const delta = movementType === 'restock' ? input.quantity : -input.quantity;
    await tx.runAsync(
      `INSERT INTO inventory_movements
        (id, item_id, movement_type, quantity_delta_integer,
         service_report_id, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      Crypto.randomUUID(),
      input.itemId,
      movementType,
      delta,
      input.serviceReportId ?? null,
      description,
      now,
    );

    await appendAuditEvent(tx, {
      eventType: `inventory.${movementType}`,
      entityType: 'item',
      entityId: input.itemId,
      details: { quantity: input.quantity, serviceReportId: input.serviceReportId ?? null },
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });
}

function mapInventoryItemRow(row: InventoryItemRow): InventoryItemSummary {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    unitLabel: row.unit_label,
    baseSellingPriceCentavos: row.base_selling_price_centavos,
    lowStockThreshold: row.low_stock_threshold,
    currentStock: row.current_stock,
    active: row.active === 1,
  };
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }
}
