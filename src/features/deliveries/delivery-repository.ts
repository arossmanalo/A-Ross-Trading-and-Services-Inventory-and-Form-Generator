import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { allocateDocumentNumber } from '@/db/sequences';
import { validateBusinessDate } from '@/domain/business-date';
import { deleteLinkedDeliveryStatementDrafts, syncLinkedDeliveryLines } from '@/features/billing-statements/billing-statement-repository';
import { assertPositiveIntegerQuantity } from '@/domain/stock';
import { DELIVERY_TEMPLATE_VERSION, buildDeliveryHtml, type DeliveryRenderSnapshot } from '@/features/deliveries/delivery-template';
import type {
  DeliveryDetail,
  DeliveryDraftInput,
  DeliveryLine,
  DeliveryLinkedStatement,
  DeliveryListItem,
  DeliveryPriceSource,
  DeliveryState,
  DeliverySummary,
} from '@/features/deliveries/delivery-types';
import { getBusinessLogo } from '@/features/settings/settings-repository';
import { getPreparerSignatureHtml } from '@/features/signatures/capture-repository';

type SummaryRow = {
  id: string;
  df_number: string | null;
  customer_name: string;
  document_state: DeliveryState;
  business_date: string;
  subtotal_centavos: number;
  pdf_state: DeliverySummary['pdfState'];
};

type DetailRow = SummaryRow & {
  customer_id: string;
  customer_address: string;
  delivered_by: string;
  received_by: string;
  notes: string;
  signature_status: string;
  has_signed_version: number;
  share_state: 'not_shared' | 'shared';
  finalized_at: string | null;
  void_reason: string | null;
};

type LineRow = {
  id: string;
  item_id: string;
  description_snapshot: string;
  unit_label: string | null;
  quantity_integer: number;
  unit_price_centavos: number;
  amount_centavos: number;
  price_source: DeliveryPriceSource;
  override_reason: string | null;
  current_stock: number;
  item_active?: number;
};

export async function listDeliveries(db: SQLiteDatabase): Promise<DeliveryListItem[]> {
  const rows = await db.getAllAsync<SummaryRow>(
    `SELECT d.id, d.df_number, c.name AS customer_name, d.document_state, d.business_date, d.subtotal_centavos, d.pdf_state
     FROM deliveries d JOIN customers c ON c.id = d.customer_id
     ORDER BY d.created_at DESC, d.rowid DESC`,
  );
  const lineRows = await db.getAllAsync<{ delivery_id: string; description_snapshot: string }>(
    'SELECT delivery_id, description_snapshot FROM delivery_lines ORDER BY created_at, rowid',
  );
  const descriptions = new Map<string, string[]>();
  for (const line of lineRows) descriptions.set(line.delivery_id, [...(descriptions.get(line.delivery_id) ?? []), line.description_snapshot]);
  const linked = await loadLinkedStatements(db);
  return rows.map((row) => ({
    ...mapSummary(row, linked.get(row.id) ?? []),
    searchText: [
      row.df_number ?? 'draft',
      row.customer_name,
      row.business_date,
      row.document_state,
      (row.subtotal_centavos / 100).toFixed(2),
      ...(linked.get(row.id) ?? []).map((statement) => statement.bsNumber ?? 'draft statement'),
      ...(descriptions.get(row.id) ?? []),
    ].join(' ').toLowerCase(),
  }));
}

export async function getDelivery(db: SQLiteDatabase, deliveryId: string): Promise<DeliveryDetail | null> {
  const row = await db.getFirstAsync<DetailRow>(
    `SELECT d.*, c.name AS customer_name, c.address AS customer_address,
            CASE WHEN EXISTS (SELECT 1 FROM signature_captures sc WHERE sc.owner_type='delivery' AND sc.owner_id=d.id)
                   OR EXISTS (SELECT 1 FROM document_attachments da WHERE da.owner_type='delivery' AND da.owner_id=d.id AND da.attachment_type='external_signed_pdf')
                 THEN 1 ELSE 0 END AS has_signed_version
     FROM deliveries d JOIN customers c ON c.id = d.customer_id WHERE d.id = ?`,
    deliveryId,
  );
  if (!row) return null;
  return {
    ...mapSummary(row, (await loadLinkedStatements(db, deliveryId)).get(deliveryId) ?? []),
    customerId: row.customer_id,
    customerAddress: row.customer_address,
    deliveredBy: row.delivered_by,
    receivedBy: row.received_by,
    notes: row.notes,
    signatureStatus: row.signature_status,
    hasSignedVersion: row.has_signed_version === 1,
    shareState: row.share_state,
    finalizedAt: row.finalized_at,
    voidReason: row.void_reason,
    lines: await listLines(db, deliveryId),
  };
}

export async function createDeliveryDraft(
  db: SQLiteDatabase,
  input: { customerId: string; businessDate: string } & Partial<Omit<DeliveryDraftInput, 'businessDate'>>,
): Promise<string> {
  validateBusinessDate(input.businessDate);
  const deliveryId = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const customer = await tx.getFirstAsync<{ active: number }>(
      'SELECT active FROM customers WHERE id = ? AND merged_into_customer_id IS NULL',
      input.customerId,
    );
    if (!customer || customer.active !== 1) throw new Error('Select an active customer for a delivery.');
    await tx.runAsync(
      `INSERT INTO deliveries (id, customer_id, document_state, business_date, delivered_by, received_by, notes, created_at)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)`,
      deliveryId, input.customerId, input.businessDate, input.deliveredBy?.trim() ?? '', input.receivedBy?.trim() ?? '', input.notes?.trim() ?? '', now,
    );
    await auditAndRevise(tx, 'delivery.draft_created', deliveryId, { customerId: input.customerId }, now);
  });
  return deliveryId;
}

export async function updateDeliveryDraft(db: SQLiteDatabase, deliveryId: string, input: DeliveryDraftInput): Promise<void> {
  validateBusinessDate(input.businessDate);
  await db.withExclusiveTransactionAsync(async (tx) => {
    const result = await tx.runAsync(
      "UPDATE deliveries SET business_date=?, delivered_by=?, received_by=?, notes=? WHERE id=? AND document_state='draft'",
      input.businessDate, input.deliveredBy.trim(), input.receivedBy.trim(), input.notes.trim(), deliveryId,
    );
    if (result.changes !== 1) throw new Error('Only a draft delivery can be edited.');
    await auditAndRevise(tx, 'delivery.draft_saved', deliveryId, {}, new Date().toISOString());
  });
}

/**
 * Adds an inventory item to a draft delivery. Each item appears once; change its
 * quantity instead of adding it again. The price is resolved now (customer price
 * over base price) and kept, because a linked Billing Statement bills these lines.
 */
export async function addDeliveryItemLine(
  db: SQLiteDatabase,
  deliveryId: string,
  input: { itemId: string; quantity: number; unitPriceCentavos?: number; overrideReason?: string },
): Promise<void> {
  assertPositiveIntegerQuantity(input.quantity);
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ name: string; active: number; base_selling_price_centavos: number; customer_price_centavos: number | null }>(
      `SELECT i.name, i.active, i.base_selling_price_centavos, p.selling_price_centavos AS customer_price_centavos
       FROM deliveries d JOIN items i ON i.id = ?
       LEFT JOIN customer_item_prices p ON p.item_id = i.id AND p.customer_id = d.customer_id AND p.effective_to IS NULL
       WHERE d.id = ? AND d.document_state = 'draft'`,
      input.itemId, deliveryId,
    );
    if (!row) throw new Error('Only a draft delivery can be edited.');
    if (row.active !== 1) throw new Error('Select an active inventory item.');
    const existing = await tx.getFirstAsync<{ id: string }>('SELECT id FROM delivery_lines WHERE delivery_id = ? AND item_id = ?', deliveryId, input.itemId);
    if (existing) throw new Error(`${row.name} is already on this delivery. Change its quantity instead.`);
    const resolved = row.customer_price_centavos ?? row.base_selling_price_centavos;
    const price = input.unitPriceCentavos ?? resolved;
    assertMoney(price, 'Unit price');
    const overridden = price !== resolved;
    const reason = input.overrideReason?.trim() || null;
    if (overridden && !reason) throw new Error('A reason is required when overriding the resolved item price.');
    await tx.runAsync(
      `INSERT INTO delivery_lines (id, delivery_id, item_id, description_snapshot, quantity_integer, unit_price_centavos, amount_centavos, price_source, override_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      Crypto.randomUUID(), deliveryId, input.itemId, row.name, input.quantity, price, safeMultiply(price, input.quantity),
      overridden ? 'override' : row.customer_price_centavos === null ? 'base' : 'customer', reason, now,
    );
    await refreshTotal(tx, deliveryId);
    await syncLinkedDeliveryLines(tx, deliveryId);
    await auditAndRevise(tx, 'delivery.item_added', deliveryId, { itemId: input.itemId, quantity: input.quantity, overridden }, now);
  });
}

export async function updateDeliveryLineQuantity(db: SQLiteDatabase, deliveryId: string, lineId: string, quantity: number): Promise<void> {
  assertPositiveIntegerQuantity(quantity);
  await db.withExclusiveTransactionAsync(async (tx) => {
    const line = await tx.getFirstAsync<{ unit_price_centavos: number }>(
      "SELECT l.unit_price_centavos FROM delivery_lines l JOIN deliveries d ON d.id = l.delivery_id WHERE l.id = ? AND l.delivery_id = ? AND d.document_state = 'draft'",
      lineId, deliveryId,
    );
    if (!line) throw new Error('Only a draft delivery can be edited.');
    await tx.runAsync('UPDATE delivery_lines SET quantity_integer = ?, amount_centavos = ? WHERE id = ?', quantity, safeMultiply(line.unit_price_centavos, quantity), lineId);
    await refreshTotal(tx, deliveryId);
    await syncLinkedDeliveryLines(tx, deliveryId);
    await auditAndRevise(tx, 'delivery.quantity_changed', deliveryId, { lineId, quantity }, new Date().toISOString());
  });
}

export async function removeDeliveryLine(db: SQLiteDatabase, deliveryId: string, lineId: string): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const draft = await tx.getFirstAsync<{ id: string }>("SELECT id FROM deliveries WHERE id = ? AND document_state = 'draft'", deliveryId);
    if (!draft) throw new Error('Only a draft delivery can be edited.');
    // The linked statement's line must go before the delivery line it points at.
    await syncLinkedDeliveryLines(tx, deliveryId, undefined, [lineId]);
    const result = await tx.runAsync('DELETE FROM delivery_lines WHERE id = ? AND delivery_id = ?', lineId, deliveryId);
    if (result.changes !== 1) throw new Error('Delivery line was not found.');
    await refreshTotal(tx, deliveryId);
    await auditAndRevise(tx, 'delivery.line_removed', deliveryId, { lineId }, new Date().toISOString());
  });
}

export async function deleteDeliveryDraft(db: SQLiteDatabase, deliveryId: string): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const draft = await tx.getFirstAsync<{ id: string }>("SELECT id FROM deliveries WHERE id = ? AND document_state = 'draft'", deliveryId);
    if (!draft) throw new Error('Only a draft delivery can be deleted.');
    await deleteLinkedDeliveryStatementDrafts(tx, deliveryId, new Date().toISOString());
    await tx.runAsync('DELETE FROM delivery_lines WHERE delivery_id = ?', deliveryId);
    await tx.runAsync('DELETE FROM deliveries WHERE id = ?', deliveryId);
    await auditAndRevise(tx, 'delivery.draft_deleted', deliveryId, {}, new Date().toISOString());
  });
}

/**
 * Finalizes a delivery in one transaction: checks stock for every line, allocates
 * the next DF number, freezes the form, and deducts the delivered quantities
 * (one 'sale' stock transaction, one movement per line). Prices are the ones
 * saved on the lines, so a linked Billing Statement bills exactly what was
 * delivered at those prices.
 */
export async function finalizeDelivery(db: SQLiteDatabase, deliveryId: string): Promise<{ dfNumber: string; html: string; snapshot: DeliveryRenderSnapshot }> {
  let result: { dfNumber: string; html: string; snapshot: DeliveryRenderSnapshot } | null = null;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<DetailRow & {
      business_name: string; business_address: string; contact_details: string;
      content_snapshot_json: string | null; render_template_snapshot: string | null;
    }>(
      `SELECT d.*, c.name AS customer_name, c.address AS customer_address, s.business_name, s.business_address, s.contact_details
       FROM deliveries d JOIN customers c ON c.id = d.customer_id JOIN settings s ON s.id = 'business'
       WHERE d.id = ?`,
      deliveryId,
    );
    if (!row) throw new Error('Delivery was not found.');
    if (row.document_state === 'finalized') {
      if (!row.df_number || !row.content_snapshot_json || !row.render_template_snapshot) throw new Error('Finalized delivery snapshot is incomplete.');
      result = { dfNumber: row.df_number, html: row.render_template_snapshot, snapshot: JSON.parse(row.content_snapshot_json) as DeliveryRenderSnapshot };
      return;
    }
    if (row.document_state !== 'draft') throw new Error('Only a draft delivery can be finalized.');
    const lines = await tx.getAllAsync<LineRow>(
      `SELECT l.*, i.unit_label, i.active AS item_active,
              COALESCE((SELECT SUM(m.quantity_delta_integer) FROM inventory_movements m WHERE m.item_id = l.item_id), 0) AS current_stock
       FROM delivery_lines l JOIN items i ON i.id = l.item_id
       WHERE l.delivery_id = ? ORDER BY l.created_at, l.rowid`,
      deliveryId,
    );
    if (!lines.length) throw new Error('Add at least one inventory item before finalizing the delivery.');
    for (const line of lines) {
      if (line.item_active !== 1) throw new Error(`${line.description_snapshot} is inactive. Remove it or reactivate it before finalizing.`);
      if (line.quantity_integer > line.current_stock) throw new Error(`${line.description_snapshot}: only ${line.current_stock} available, ${line.quantity_integer} required.`);
    }
    const dfNumber = await allocateDocumentNumber(tx, 'DF');
    const snapshot: DeliveryRenderSnapshot = {
      dfNumber,
      businessDate: row.business_date,
      fingerprint: '',
      business: { name: row.business_name, address: row.business_address, contactDetails: row.contact_details },
      customer: { name: row.customer_name, address: row.customer_address },
      deliveredBy: row.delivered_by,
      receivedBy: row.received_by,
      notes: row.notes,
      lines: lines.map((line) => ({ description: line.description_snapshot, quantity: line.quantity_integer, unitLabel: line.unit_label || 'pc' })),
    };
    snapshot.preparerSignatureHtml = await getPreparerSignatureHtml(tx);
    snapshot.business.logoDataUrl = await getBusinessLogo(tx);
    snapshot.fingerprint = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(snapshot))).slice(0, 12).toUpperCase();
    const html = buildDeliveryHtml(snapshot);
    const now = new Date().toISOString();
    const transactionId = Crypto.randomUUID();
    await tx.runAsync(
      `INSERT INTO stock_transactions (id, customer_id, delivery_id, transaction_type, state, note, created_at) VALUES (?, ?, ?, 'sale', 'active', ?, ?)`,
      transactionId, row.customer_id, deliveryId, `Finalized ${dfNumber}`, now,
    );
    for (const line of lines) {
      await tx.runAsync(
        `INSERT INTO inventory_movements (id, item_id, stock_transaction_id, movement_type, quantity_delta_integer, delivery_id, delivery_line_id, description, created_at)
         VALUES (?, ?, ?, 'sale', ?, ?, ?, ?, ?)`,
        Crypto.randomUUID(), line.item_id, transactionId, -line.quantity_integer, deliveryId, line.id, `${dfNumber}: ${line.description_snapshot}`, now,
      );
    }
    const subtotal = lines.reduce((sum, line) => sum + line.amount_centavos, 0);
    await tx.runAsync(
      `UPDATE deliveries SET df_number=?, document_state='finalized', subtotal_centavos=?, content_snapshot_json=?, render_template_snapshot=?, template_version=?, pdf_state='pending', finalized_at=?
       WHERE id=? AND document_state='draft'`,
      dfNumber, subtotal, JSON.stringify(snapshot), html, DELIVERY_TEMPLATE_VERSION, now, deliveryId,
    );
    await auditAndRevise(tx, 'delivery.finalized', deliveryId, { dfNumber, lineCount: lines.length }, now);
    result = { dfNumber, html, snapshot };
  });
  if (!result) throw new Error('Delivery finalization did not produce a result.');
  return result;
}

/**
 * Voids a finalized delivery. The user says, for each item, whether it came back
 * into stock; returned items get a reversal movement. A delivery that a live
 * Billing Statement bills cannot be voided until that statement is voided.
 */
export async function voidDelivery(
  db: SQLiteDatabase,
  deliveryId: string,
  reason: string,
  dispositions: Array<{ itemId: string; returnedToStock: boolean }>,
): Promise<void> {
  const cleanReason = reason.trim();
  if (!cleanReason) throw new Error('Void reason is required.');
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ df_number: string; customer_id: string }>(
      "SELECT df_number, customer_id FROM deliveries WHERE id = ? AND document_state = 'finalized'",
      deliveryId,
    );
    if (!row) throw new Error('Only a finalized delivery can be voided.');
    const billed = await tx.getFirstAsync<{ bs_number: string | null }>(
      "SELECT bs_number FROM billing_statements WHERE source_delivery_id = ? AND document_state <> 'voided' LIMIT 1",
      deliveryId,
    );
    if (billed) throw new Error(`Void ${billed.bs_number ?? 'the linked Billing Statement draft'} first; it bills this delivery.`);
    const movements = await tx.getAllAsync<{ id: string; item_id: string; quantity_delta_integer: number; delivery_line_id: string; description: string }>(
      "SELECT id, item_id, quantity_delta_integer, delivery_line_id, description FROM inventory_movements WHERE delivery_id = ? AND movement_type = 'sale'",
      deliveryId,
    );
    const choices = new Map(dispositions.map((entry) => [entry.itemId, entry.returnedToStock]));
    for (const movement of movements) {
      if (!choices.has(movement.item_id)) throw new Error('Choose a stock disposition for every delivered item.');
    }
    const original = await tx.getFirstAsync<{ id: string }>("SELECT id FROM stock_transactions WHERE delivery_id = ? AND transaction_type = 'sale' AND state = 'active'", deliveryId);
    if (original) await tx.runAsync("UPDATE stock_transactions SET state='voided', voided_at=? WHERE id=?", now, original.id);
    const returned = movements.filter((movement) => choices.get(movement.item_id));
    if (returned.length) {
      const reversalId = Crypto.randomUUID();
      await tx.runAsync(
        `INSERT INTO stock_transactions (id, customer_id, delivery_id, transaction_type, state, note, created_at) VALUES (?, ?, ?, 'reversal', 'active', ?, ?)`,
        reversalId, row.customer_id, deliveryId, `Stock returned after voiding ${row.df_number}`, now,
      );
      for (const movement of returned) {
        await tx.runAsync(
          `INSERT INTO inventory_movements (id, item_id, stock_transaction_id, movement_type, quantity_delta_integer, delivery_id, delivery_line_id, source_movement_id, description, created_at)
           VALUES (?, ?, ?, 'reversal', ?, ?, ?, ?, ?, ?)`,
          Crypto.randomUUID(), movement.item_id, reversalId, -movement.quantity_delta_integer, deliveryId, movement.delivery_line_id, movement.id, `Return after voiding ${row.df_number}: ${movement.description}`, now,
        );
      }
    }
    await tx.runAsync("UPDATE deliveries SET document_state='voided', voided_at=?, void_reason=? WHERE id=?", now, cleanReason, deliveryId);
    await auditAndRevise(tx, 'delivery.voided', deliveryId, { reason: cleanReason, returnedItemCount: returned.length }, now);
  });
}

async function listLines(db: SQLiteDatabase, deliveryId: string): Promise<DeliveryLine[]> {
  const rows = await db.getAllAsync<LineRow>(
    `SELECT l.*, i.unit_label,
            COALESCE((SELECT SUM(m.quantity_delta_integer) FROM inventory_movements m WHERE m.item_id = l.item_id), 0) AS current_stock
     FROM delivery_lines l LEFT JOIN items i ON i.id = l.item_id
     WHERE l.delivery_id = ? ORDER BY l.created_at, l.rowid`,
    deliveryId,
  );
  return rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    description: row.description_snapshot,
    unitLabel: row.unit_label || 'pc',
    quantity: row.quantity_integer,
    unitPriceCentavos: row.unit_price_centavos,
    amountCentavos: row.amount_centavos,
    priceSource: row.price_source,
    overrideReason: row.override_reason,
    currentStock: row.current_stock,
  }));
}

async function refreshTotal(db: SQLiteDatabase, deliveryId: string): Promise<void> {
  const row = await db.getFirstAsync<{ subtotal: number }>('SELECT COALESCE(SUM(amount_centavos), 0) AS subtotal FROM delivery_lines WHERE delivery_id = ?', deliveryId);
  await db.runAsync("UPDATE deliveries SET subtotal_centavos = ? WHERE id = ? AND document_state = 'draft'", row?.subtotal ?? 0, deliveryId);
}

function mapSummary(row: SummaryRow, linkedStatements: DeliveryLinkedStatement[]): DeliverySummary {
  return {
    id: row.id,
    dfNumber: row.df_number,
    customerName: row.customer_name,
    documentState: row.document_state,
    businessDate: row.business_date,
    totalCentavos: row.subtotal_centavos,
    pdfState: row.pdf_state,
    linkedStatements,
  };
}

function assertMoney(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative amount.`);
}

function safeMultiply(price: number, quantity: number): number {
  const value = price * quantity;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Line amount is too large.');
  return value;
}

async function auditAndRevise(db: SQLiteDatabase, eventType: string, entityId: string, details: Record<string, string | number | boolean | null>, createdAt: string): Promise<void> {
  await appendAuditEvent(db, { eventType, entityType: 'delivery', entityId, details, createdAt });
  await incrementDatabaseRevision(db);
}

async function loadLinkedStatements(db: SQLiteDatabase, deliveryId?: string): Promise<Map<string, DeliveryLinkedStatement[]>> {
  const rows = await db.getAllAsync<{ id: string; source_delivery_id: string; bs_number: string | null; document_state: DeliveryState; discounted_total_centavos: number }>(
    `SELECT id, source_delivery_id, bs_number, document_state, discounted_total_centavos
     FROM billing_statements
     WHERE source_delivery_id IS NOT NULL AND document_state <> 'voided' AND (? IS NULL OR source_delivery_id = ?)
     ORDER BY created_at ASC, rowid ASC`,
    deliveryId ?? null,
    deliveryId ?? null,
  );
  const grouped = new Map<string, DeliveryLinkedStatement[]>();
  for (const row of rows) {
    const list = grouped.get(row.source_delivery_id) ?? [];
    list.push({ id: row.id, bsNumber: row.bs_number, documentState: row.document_state, totalCentavos: row.discounted_total_centavos });
    grouped.set(row.source_delivery_id, list);
  }
  return grouped;
}
