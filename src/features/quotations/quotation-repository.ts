import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { allocateDocumentNumber } from '@/db/sequences';
import { validateBusinessDate } from '@/domain/business-date';
import { calculateDiscountCentavos, type Discount } from '@/domain/money';
import { defaultValidUntil, validateValidUntil } from '@/domain/quotation';
import { assertPositiveIntegerQuantity } from '@/domain/stock';
import { getPreparerSignatureHtml } from '@/features/signatures/capture-repository';
import { getBusinessLogo } from '@/features/settings/settings-repository';
import { QUOTATION_TEMPLATE_VERSION, buildQuotationHtml, type QuotationRenderSnapshot } from '@/features/quotations/quotation-template';
import type {
  QuotationConvertedKind,
  QuotationDetail,
  QuotationDiscountType,
  QuotationLine,
  QuotationListItem,
  QuotationPriceSource,
  QuotationState,
  QuotationSummary,
} from '@/features/quotations/quotation-types';

type SummaryRow = {
  id: string;
  qt_number: string | null;
  customer_name: string;
  document_state: QuotationState;
  business_date: string;
  valid_until: string;
  discounted_total_centavos: number;
  pdf_state: QuotationSummary['pdfState'];
  converted_kind: QuotationConvertedKind | null;
};

type DetailRow = SummaryRow & {
  customer_id: string;
  customer_address: string;
  subtotal_centavos: number;
  discount_type: QuotationDiscountType;
  discount_value: number;
  signature_status: string;
  has_signed_version: number;
  share_state: 'not_shared' | 'shared';
  finalized_at: string | null;
  converted_service_report_id: string | null;
  converted_delivery_id: string | null;
  converted_billing_statement_id: string | null;
};

type LineRow = {
  id: string;
  line_type: 'item' | 'service';
  item_id: string | null;
  service_id: string | null;
  description_snapshot: string;
  quantity_integer: number;
  unit_price_centavos: number;
  amount_centavos: number;
  price_source: QuotationPriceSource;
  override_reason: string | null;
  unit_label?: string | null;
};

export async function listQuotations(db: SQLiteDatabase): Promise<QuotationListItem[]> {
  const rows = await db.getAllAsync<SummaryRow>(
    `SELECT q.id, q.qt_number, c.name AS customer_name, q.document_state, q.business_date, q.valid_until,
            q.discounted_total_centavos, q.pdf_state, q.converted_kind
     FROM quotations q JOIN customers c ON c.id = q.customer_id
     ORDER BY q.created_at DESC, q.rowid DESC`,
  );
  const lineRows = await db.getAllAsync<{ quotation_id: string; description_snapshot: string }>(
    'SELECT quotation_id, description_snapshot FROM quotation_lines ORDER BY created_at, rowid',
  );
  const descriptions = new Map<string, string[]>();
  for (const line of lineRows) descriptions.set(line.quotation_id, [...(descriptions.get(line.quotation_id) ?? []), line.description_snapshot]);
  return rows.map((row) => {
    const summary = mapSummary(row);
    const searchText = [
      row.qt_number ?? 'draft',
      row.customer_name,
      row.business_date,
      row.valid_until,
      row.document_state,
      (row.discounted_total_centavos / 100).toFixed(2),
      row.converted_kind ?? '',
      ...(descriptions.get(row.id) ?? []),
    ].join(' ').toLowerCase();
    return { ...summary, searchText };
  });
}

export async function getQuotation(db: SQLiteDatabase, quotationId: string): Promise<QuotationDetail | null> {
  const row = await db.getFirstAsync<DetailRow>(
    `SELECT q.*, c.name AS customer_name, c.address AS customer_address,
            CASE WHEN EXISTS (SELECT 1 FROM signature_captures sc WHERE sc.owner_type='quotation' AND sc.owner_id=q.id)
                   OR EXISTS (SELECT 1 FROM document_attachments da WHERE da.owner_type='quotation' AND da.owner_id=q.id AND da.attachment_type='external_signed_pdf')
                 THEN 1 ELSE 0 END AS has_signed_version
     FROM quotations q JOIN customers c ON c.id = q.customer_id WHERE q.id = ?`,
    quotationId,
  );
  if (!row) return null;
  const lines = await listLines(db, quotationId);
  return {
    ...mapSummary(row),
    customerId: row.customer_id,
    customerAddress: row.customer_address,
    subtotalCentavos: row.subtotal_centavos,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    signatureStatus: row.signature_status,
    hasSignedVersion: row.has_signed_version === 1,
    shareState: row.share_state,
    finalizedAt: row.finalized_at,
    convertedServiceReportId: row.converted_service_report_id,
    convertedDeliveryId: row.converted_delivery_id,
    convertedBillingStatementId: row.converted_billing_statement_id,
    lines,
  };
}

export async function createQuotationDraft(
  db: SQLiteDatabase,
  input: { customerId: string; businessDate: string; validUntil?: string },
): Promise<string> {
  validateBusinessDate(input.businessDate);
  const validUntil = input.validUntil ?? defaultValidUntil(input.businessDate);
  validateValidUntil(validUntil, input.businessDate);
  const quotationId = Crypto.randomUUID();
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const customer = await tx.getFirstAsync<{ active: number }>(
      'SELECT active FROM customers WHERE id = ? AND merged_into_customer_id IS NULL',
      input.customerId,
    );
    if (!customer || customer.active !== 1) throw new Error('Select an active customer for a quotation.');
    await tx.runAsync(
      `INSERT INTO quotations (id, customer_id, document_state, business_date, valid_until, created_at)
       VALUES (?, ?, 'draft', ?, ?, ?)`,
      quotationId, input.customerId, input.businessDate, validUntil, now,
    );
    await auditAndRevise(tx, 'quotation.draft_created', quotationId, { customerId: input.customerId }, now);
  });
  return quotationId;
}

export async function updateQuotationDraft(
  db: SQLiteDatabase,
  quotationId: string,
  input: { businessDate: string; validUntil: string; discountType: QuotationDiscountType; discountValue: number },
): Promise<void> {
  validateBusinessDate(input.businessDate);
  validateValidUntil(input.validUntil, input.businessDate);
  if (!Number.isSafeInteger(input.discountValue) || input.discountValue < 0) throw new Error('Discount must be non-negative.');
  if (input.discountType === 'percentage' && input.discountValue > 10_000) throw new Error('Percentage discount cannot exceed 100%.');
  await db.withExclusiveTransactionAsync(async (tx) => {
    const subtotal = await getSubtotal(tx, quotationId);
    const discountCentavos = calculateDiscountCentavos(subtotal, toDiscount(input.discountType, input.discountValue));
    const result = await tx.runAsync(
      `UPDATE quotations SET business_date=?, valid_until=?, discount_type=?, discount_value=?, subtotal_centavos=?, discounted_total_centavos=?
       WHERE id=? AND document_state='draft'`,
      input.businessDate, input.validUntil, input.discountType, input.discountType ? input.discountValue : 0, subtotal, subtotal - discountCentavos, quotationId,
    );
    if (result.changes !== 1) throw new Error('Only a draft quotation can be edited.');
    await auditAndRevise(tx, 'quotation.draft_saved', quotationId, { discountCentavos }, new Date().toISOString());
  });
}

export async function addQuotationItemLine(
  db: SQLiteDatabase,
  quotationId: string,
  input: { itemId: string; quantity: number; unitPriceCentavos?: number; overrideReason?: string },
): Promise<void> {
  assertPositiveIntegerQuantity(input.quantity);
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ name: string; active: number; base_selling_price_centavos: number; customer_price_centavos: number | null }>(
      `SELECT i.name, i.active, i.base_selling_price_centavos, p.selling_price_centavos AS customer_price_centavos
       FROM quotations q JOIN items i ON i.id = ?
       LEFT JOIN customer_item_prices p ON p.item_id = i.id AND p.customer_id = q.customer_id AND p.effective_to IS NULL
       WHERE q.id = ? AND q.document_state = 'draft'`,
      input.itemId, quotationId,
    );
    if (!row || row.active !== 1) throw new Error('Select an active item for a draft quotation.');
    const resolved = row.customer_price_centavos ?? row.base_selling_price_centavos;
    const price = input.unitPriceCentavos ?? resolved;
    assertMoney(price, 'Unit price');
    const overridden = price !== resolved;
    const reason = input.overrideReason?.trim() || null;
    if (overridden && !reason) throw new Error('A reason is required when overriding the resolved item price.');
    await tx.runAsync(
      `INSERT INTO quotation_lines (id, quotation_id, line_type, item_id, description_snapshot, quantity_integer, unit_price_centavos, amount_centavos, price_source, override_reason, created_at)
       VALUES (?, ?, 'item', ?, ?, ?, ?, ?, ?, ?, ?)`,
      Crypto.randomUUID(), quotationId, input.itemId, row.name, input.quantity, price, safeMultiply(price, input.quantity),
      overridden ? 'override' : row.customer_price_centavos === null ? 'base' : 'customer', reason, now,
    );
    await refreshTotals(tx, quotationId);
    await auditAndRevise(tx, 'quotation.item_added', quotationId, { itemId: input.itemId, quantity: input.quantity, overridden }, now);
  });
}

export async function addQuotationServiceLine(
  db: SQLiteDatabase,
  quotationId: string,
  input: { serviceId: string; rateCentavos?: number; overrideReason?: string },
): Promise<void> {
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const draft = await tx.getFirstAsync<{ id: string }>("SELECT id FROM quotations WHERE id = ? AND document_state = 'draft'", quotationId);
    if (!draft) throw new Error('Only a draft quotation can be edited.');
    const service = await tx.getFirstAsync<{ name: string; active: number; base_rate_centavos: number }>(
      'SELECT name, active, base_rate_centavos FROM services WHERE id = ?',
      input.serviceId,
    );
    if (!service || service.active !== 1) throw new Error('Select an active service for a draft quotation.');
    const rate = input.rateCentavos ?? service.base_rate_centavos;
    assertMoney(rate, 'Service rate');
    const overridden = rate !== service.base_rate_centavos;
    const reason = input.overrideReason?.trim() || null;
    if (overridden && !reason) throw new Error('A reason is required when overriding the service rate.');
    await tx.runAsync(
      `INSERT INTO quotation_lines (id, quotation_id, line_type, service_id, description_snapshot, quantity_integer, unit_price_centavos, amount_centavos, price_source, override_reason, created_at)
       VALUES (?, ?, 'service', ?, ?, 1, ?, ?, ?, ?, ?)`,
      Crypto.randomUUID(), quotationId, input.serviceId, service.name, rate, rate, overridden ? 'override' : 'catalog', reason, now,
    );
    await refreshTotals(tx, quotationId);
    await auditAndRevise(tx, 'quotation.service_added', quotationId, { serviceId: input.serviceId, overridden }, now);
  });
}

export async function removeQuotationLine(db: SQLiteDatabase, quotationId: string, lineId: string): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const draft = await tx.getFirstAsync<{ id: string }>("SELECT id FROM quotations WHERE id = ? AND document_state = 'draft'", quotationId);
    if (!draft) throw new Error('Only a draft quotation can be edited.');
    const result = await tx.runAsync('DELETE FROM quotation_lines WHERE id = ? AND quotation_id = ?', lineId, quotationId);
    if (result.changes !== 1) throw new Error('Quotation line was not found.');
    await refreshTotals(tx, quotationId);
    await auditAndRevise(tx, 'quotation.line_removed', quotationId, { lineId }, new Date().toISOString());
  });
}

export async function deleteQuotationDraft(db: SQLiteDatabase, quotationId: string): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const draft = await tx.getFirstAsync<{ id: string }>("SELECT id FROM quotations WHERE id = ? AND document_state = 'draft'", quotationId);
    if (!draft) throw new Error('Only a draft quotation can be deleted.');
    await tx.runAsync('DELETE FROM quotation_lines WHERE quotation_id = ?', quotationId);
    await tx.runAsync('DELETE FROM quotations WHERE id = ?', quotationId);
    await auditAndRevise(tx, 'quotation.draft_deleted', quotationId, {}, new Date().toISOString());
  });
}

/**
 * Freezes the quotation: allocates the next QT number and stores the snapshot and
 * its rendered form. Quoted prices are kept exactly as entered; unlike a Billing
 * Statement there is no price-drift check because a quotation promises its prices.
 */
export async function finalizeQuotation(db: SQLiteDatabase, quotationId: string): Promise<{ qtNumber: string; html: string; snapshot: QuotationRenderSnapshot }> {
  let result: { qtNumber: string; html: string; snapshot: QuotationRenderSnapshot } | null = null;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<DetailRow & {
      business_name: string; business_address: string; contact_details: string;
      vat_display_mode: QuotationRenderSnapshot['vatDisplayMode']; vat_rate_basis_points: number;
      content_snapshot_json: string | null; render_template_snapshot: string | null;
    }>(
      `SELECT q.*, c.name AS customer_name, c.address AS customer_address,
              s.business_name, s.business_address, s.contact_details, s.vat_display_mode, s.vat_rate_basis_points
       FROM quotations q JOIN customers c ON c.id = q.customer_id JOIN settings s ON s.id = 'business'
       WHERE q.id = ?`,
      quotationId,
    );
    if (!row) throw new Error('Quotation was not found.');
    if (row.document_state === 'finalized') {
      if (!row.qt_number || !row.content_snapshot_json || !row.render_template_snapshot) throw new Error('Finalized quotation snapshot is incomplete.');
      result = { qtNumber: row.qt_number, html: row.render_template_snapshot, snapshot: JSON.parse(row.content_snapshot_json) as QuotationRenderSnapshot };
      return;
    }
    if (row.document_state !== 'draft') throw new Error('Only a draft quotation can be finalized.');
    const lines = await tx.getAllAsync<LineRow>(
      `SELECT l.*, i.unit_label FROM quotation_lines l LEFT JOIN items i ON i.id = l.item_id
       WHERE l.quotation_id = ? ORDER BY l.created_at, l.rowid`,
      quotationId,
    );
    if (!lines.length) throw new Error('Add at least one item or service before finalizing the quotation.');
    validateValidUntil(row.valid_until, row.business_date);
    const subtotal = lines.reduce((sum, line) => sum + line.amount_centavos, 0);
    const discountCentavos = calculateDiscountCentavos(subtotal, toDiscount(row.discount_type, row.discount_value));
    const total = subtotal - discountCentavos;
    const qtNumber = await allocateDocumentNumber(tx, 'QT');
    const snapshot: QuotationRenderSnapshot = {
      qtNumber,
      businessDate: row.business_date,
      validUntil: row.valid_until,
      fingerprint: '',
      business: { name: row.business_name, address: row.business_address, contactDetails: row.contact_details },
      customer: { name: row.customer_name, address: row.customer_address },
      lines: lines.map((line) => ({
        description: line.description_snapshot,
        quantity: line.quantity_integer,
        unitLabel: line.line_type === 'item' ? line.unit_label || 'pc' : 'service',
        unitPriceCentavos: line.unit_price_centavos,
        amountCentavos: line.amount_centavos,
      })),
      subtotalCentavos: subtotal,
      discountLabel: discountLabel(row.discount_type, row.discount_value),
      discountCentavos,
      totalCentavos: total,
      vatDisplayMode: row.vat_display_mode,
      vatRateBasisPoints: row.vat_rate_basis_points,
    };
    snapshot.preparerSignatureHtml = await getPreparerSignatureHtml(tx);
    snapshot.business.logoDataUrl = await getBusinessLogo(tx);
    snapshot.fingerprint = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(snapshot))).slice(0, 12).toUpperCase();
    const html = buildQuotationHtml(snapshot);
    const now = new Date().toISOString();
    await tx.runAsync(
      `UPDATE quotations SET qt_number=?, document_state='finalized', subtotal_centavos=?, discounted_total_centavos=?, vat_snapshot_json=?,
              content_snapshot_json=?, render_template_snapshot=?, template_version=?, pdf_state='pending', finalized_at=?
       WHERE id=? AND document_state='draft'`,
      qtNumber, subtotal, total, JSON.stringify({ mode: row.vat_display_mode, rateBasisPoints: row.vat_rate_basis_points }),
      JSON.stringify(snapshot), html, QUOTATION_TEMPLATE_VERSION, now, quotationId,
    );
    await auditAndRevise(tx, 'quotation.finalized', quotationId, { qtNumber, lineCount: lines.length }, now);
    result = { qtNumber, html, snapshot };
  });
  if (!result) throw new Error('Quotation finalization did not produce a result.');
  return result;
}

/** A finalized quotation is never edited; a mistake is voided and a new quotation issued. */
export async function voidQuotation(db: SQLiteDatabase, quotationId: string, reason: string): Promise<void> {
  const cleanReason = reason.trim();
  if (!cleanReason) throw new Error('Void reason is required.');
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ qt_number: string; converted_kind: string | null }>(
      "SELECT qt_number, converted_kind FROM quotations WHERE id = ? AND document_state = 'finalized'",
      quotationId,
    );
    if (!row) throw new Error('Only a finalized quotation can be voided.');
    if (row.converted_kind) throw new Error('A quotation that was converted into a CSR or delivery cannot be voided.');
    await tx.runAsync("UPDATE quotations SET document_state='voided', voided_at=?, void_reason=? WHERE id=?", now, cleanReason, quotationId);
    await auditAndRevise(tx, 'quotation.voided', quotationId, { reason: cleanReason }, now);
  });
}

async function listLines(db: SQLiteDatabase, quotationId: string): Promise<QuotationLine[]> {
  const rows = await db.getAllAsync<LineRow>('SELECT * FROM quotation_lines WHERE quotation_id = ? ORDER BY created_at, rowid', quotationId);
  return rows.map((row) => ({
    id: row.id,
    lineType: row.line_type,
    itemId: row.item_id,
    serviceId: row.service_id,
    description: row.description_snapshot,
    quantity: row.quantity_integer,
    unitPriceCentavos: row.unit_price_centavos,
    amountCentavos: row.amount_centavos,
    priceSource: row.price_source,
    overrideReason: row.override_reason,
  }));
}

async function getSubtotal(db: SQLiteDatabase, quotationId: string): Promise<number> {
  const row = await db.getFirstAsync<{ subtotal: number }>('SELECT COALESCE(SUM(amount_centavos), 0) AS subtotal FROM quotation_lines WHERE quotation_id = ?', quotationId);
  return row?.subtotal ?? 0;
}

async function refreshTotals(db: SQLiteDatabase, quotationId: string): Promise<void> {
  const row = await db.getFirstAsync<{ discount_type: QuotationDiscountType; discount_value: number }>(
    "SELECT discount_type, discount_value FROM quotations WHERE id = ? AND document_state = 'draft'",
    quotationId,
  );
  if (!row) throw new Error('Only a draft quotation can be changed.');
  const subtotal = await getSubtotal(db, quotationId);
  const discount = calculateDiscountCentavos(subtotal, toDiscount(row.discount_type, row.discount_value));
  await db.runAsync('UPDATE quotations SET subtotal_centavos = ?, discounted_total_centavos = ? WHERE id = ?', subtotal, subtotal - discount, quotationId);
}

function toDiscount(type: QuotationDiscountType, value: number): Discount {
  return type === 'fixed' ? { type: 'fixed', valueCentavos: value } : type === 'percentage' ? { type: 'percentage', basisPoints: value } : null;
}

function discountLabel(type: QuotationDiscountType, value: number): string | null {
  return type === 'fixed' ? 'Discount' : type === 'percentage' ? `Discount (${(value / 100).toFixed(2).replace(/\.00$/, '')}%)` : null;
}

function mapSummary(row: SummaryRow): QuotationSummary {
  return {
    id: row.id,
    qtNumber: row.qt_number,
    customerName: row.customer_name,
    documentState: row.document_state,
    businessDate: row.business_date,
    validUntil: row.valid_until,
    totalCentavos: row.discounted_total_centavos,
    pdfState: row.pdf_state,
    convertedKind: row.converted_kind,
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
  await appendAuditEvent(db, { eventType, entityType: 'quotation', entityId, details, createdAt });
  await incrementDatabaseRevision(db);
}
