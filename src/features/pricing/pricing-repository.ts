import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import type {
  CustomerItemPriceSummary,
  SetCustomerItemPriceInput,
} from '@/features/pricing/pricing-types';

type CustomerItemPriceRow = {
  id: string;
  item_id: string;
  item_name: string;
  sku: string | null;
  selling_price_centavos: number;
  effective_from: string;
};

export async function listActiveCustomerPrices(
  db: SQLiteDatabase,
  customerId: string,
): Promise<CustomerItemPriceSummary[]> {
  const rows = await db.getAllAsync<CustomerItemPriceRow>(
    `SELECT
       p.id,
       p.item_id,
       i.name AS item_name,
       i.sku,
       p.selling_price_centavos,
       p.effective_from
     FROM customer_item_prices p
     JOIN items i ON i.id = p.item_id
     WHERE p.customer_id = ? AND p.effective_to IS NULL
     ORDER BY i.name COLLATE NOCASE ASC`,
    customerId,
  );

  return rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    sku: row.sku,
    sellingPriceCentavos: row.selling_price_centavos,
    effectiveFrom: row.effective_from,
  }));
}

export async function setCustomerItemPrice(
  db: SQLiteDatabase,
  input: SetCustomerItemPriceInput,
): Promise<string> {
  if (!Number.isSafeInteger(input.sellingPriceCentavos) || input.sellingPriceCentavos < 0) {
    throw new Error('Customer price must be a non-negative amount.');
  }

  const priceId = Crypto.randomUUID();
  const now = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (tx) => {
    const customer = await tx.getFirstAsync<{ active: number }>(
      `SELECT active FROM customers
       WHERE id = ? AND merged_into_customer_id IS NULL`,
      input.customerId,
    );
    if (!customer) throw new Error('Customer was not found.');
    if (customer.active !== 1) throw new Error('Reactivate the customer before changing pricing.');

    const item = await tx.getFirstAsync<{ active: number; base_selling_price_centavos: number }>(
      'SELECT active, base_selling_price_centavos FROM items WHERE id = ?',
      input.itemId,
    );
    if (!item) throw new Error('Inventory item was not found.');
    if (item.active !== 1) throw new Error('Reactivate the item before changing pricing.');

    const existing = await tx.getFirstAsync<{ id: string; selling_price_centavos: number }>(
      `SELECT id, selling_price_centavos
       FROM customer_item_prices
       WHERE customer_id = ? AND item_id = ? AND effective_to IS NULL`,
      input.customerId,
      input.itemId,
    );

    if (existing?.selling_price_centavos === input.sellingPriceCentavos) {
      throw new Error('This is already the active customer price.');
    }

    if (existing) {
      await tx.runAsync(
        'UPDATE customer_item_prices SET effective_to = ? WHERE id = ? AND effective_to IS NULL',
        now,
        existing.id,
      );
    }

    await tx.runAsync(
      `INSERT INTO customer_item_prices
        (id, customer_id, item_id, selling_price_centavos, effective_from, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      priceId,
      input.customerId,
      input.itemId,
      input.sellingPriceCentavos,
      now,
      now,
    );

    await appendAuditEvent(tx, {
      eventType: existing ? 'customer_price.changed' : 'customer_price.created',
      entityType: 'customer_item_price',
      entityId: priceId,
      details: {
        customerId: input.customerId,
        itemId: input.itemId,
        oldPriceCentavos: existing?.selling_price_centavos ?? null,
        newPriceCentavos: input.sellingPriceCentavos,
        basePriceCentavos: item.base_selling_price_centavos,
      },
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });

  return priceId;
}

export async function resolveItemSellingPrice(
  db: SQLiteDatabase,
  customerId: string,
  itemId: string,
): Promise<{ priceCentavos: number; source: 'base' | 'customer' }> {
  const row = await db.getFirstAsync<{
    base_selling_price_centavos: number;
    customer_price_centavos: number | null;
  }>(
    `SELECT
       i.base_selling_price_centavos,
       p.selling_price_centavos AS customer_price_centavos
     FROM items i
     LEFT JOIN customer_item_prices p
       ON p.item_id = i.id
      AND p.customer_id = ?
      AND p.effective_to IS NULL
     WHERE i.id = ?`,
    customerId,
    itemId,
  );
  if (!row) throw new Error('Inventory item was not found.');
  return row.customer_price_centavos === null
    ? { priceCentavos: row.base_selling_price_centavos, source: 'base' }
    : { priceCentavos: row.customer_price_centavos, source: 'customer' };
}
