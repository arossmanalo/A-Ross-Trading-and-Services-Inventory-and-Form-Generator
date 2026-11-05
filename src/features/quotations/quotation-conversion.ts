import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { getLocalBusinessDate } from '@/domain/business-date';
import { addServiceLineInTx, applyDraftDiscountInTx, createBillingStatementDraftInTx } from '@/features/billing-statements/billing-statement-repository';
import { addDeliveryItemLineInTx, createDeliveryDraftInTx } from '@/features/deliveries/delivery-repository';
import { insertCsrItemUsage, insertMachineService } from '@/features/service-reports/csr-charge-repository';
import { createServiceReportDraftInTx } from '@/features/service-reports/service-report-repository';
import type { QuotationConvertedKind } from '@/features/quotations/quotation-types';

/** What a finalized quotation becomes: a repair (CSR) on chosen machines, or a delivery. */
export type QuotationConversion =
  | { kind: 'repair'; equipmentIds: string[] }
  | { kind: 'delivery' };

export type QuotationConversionResult = {
  kind: QuotationConvertedKind;
  /** The new CSR or Delivery draft. */
  documentId: string;
  /** The Billing Statement draft created with it. */
  billingStatementId: string;
};

type QuoteLine = {
  line_type: 'item' | 'service';
  item_id: string | null;
  service_id: string | null;
  description_snapshot: string;
  quantity_integer: number;
  unit_price_centavos: number;
};

export type MergedQuote = {
  items: Array<{ itemId: string; name: string; quantity: number; unitPriceCentavos: number }>;
  services: Array<{ serviceId: string; name: string; rateCentavos: number }>;
};

/**
 * A quotation may list the same item on several lines, but a CSR or delivery
 * holds each item once. Lines of one item at the same price are added together;
 * the same item at different prices cannot be merged and is refused.
 */
export function mergeQuoteLines(lines: readonly QuoteLine[]): MergedQuote {
  const items = new Map<string, MergedQuote['items'][number]>();
  const services: MergedQuote['services'] = [];
  for (const line of lines) {
    if (line.line_type === 'service' && line.service_id) {
      services.push({ serviceId: line.service_id, name: line.description_snapshot, rateCentavos: line.unit_price_centavos });
      continue;
    }
    if (line.line_type !== 'item' || !line.item_id) continue;
    const existing = items.get(line.item_id);
    if (!existing) {
      items.set(line.item_id, { itemId: line.item_id, name: line.description_snapshot, quantity: line.quantity_integer, unitPriceCentavos: line.unit_price_centavos });
    } else if (existing.unitPriceCentavos !== line.unit_price_centavos) {
      throw new Error(`${line.description_snapshot} is quoted at two different prices. Void this quotation and issue one with a single price for it.`);
    } else {
      existing.quantity += line.quantity_integer;
    }
  }
  return { items: [...items.values()], services };
}

/**
 * Converts a finalized, unconverted quotation in one transaction: creates the
 * CSR draft (repair) or Delivery draft (delivery) with the quoted items and
 * services at the quoted prices, creates its linked Billing Statement draft,
 * carries the quotation's discount onto it, and marks the quotation converted.
 * If any step fails nothing is kept.
 *
 * Repair: items go on the CSR and each quoted service is priced on the first
 * chosen machine. Delivery: items go on the delivery, which holds items only;
 * quoted services become service lines on the Billing Statement.
 */
export async function convertQuotation(
  db: SQLiteDatabase,
  quotationId: string,
  conversion: QuotationConversion,
  businessDate: string = getLocalBusinessDate(),
): Promise<QuotationConversionResult> {
  let result: QuotationConversionResult | null = null;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const quotation = await tx.getFirstAsync<{ customer_id: string; qt_number: string | null; document_state: string; converted_kind: string | null; discount_type: 'fixed' | 'percentage' | null; discount_value: number }>(
      'SELECT customer_id, qt_number, document_state, converted_kind, discount_type, discount_value FROM quotations WHERE id = ?',
      quotationId,
    );
    if (!quotation) throw new Error('Quotation was not found.');
    if (quotation.document_state !== 'finalized' || !quotation.qt_number) throw new Error('Only a finalized quotation can be converted.');
    if (quotation.converted_kind) throw new Error('This quotation has already been converted.');
    const lines = await tx.getAllAsync<QuoteLine>(
      'SELECT line_type, item_id, service_id, description_snapshot, quantity_integer, unit_price_centavos FROM quotation_lines WHERE quotation_id = ? ORDER BY created_at, rowid',
      quotationId,
    );
    const quote = mergeQuoteLines(lines);
    const reason = `Quoted on ${quotation.qt_number}`;
    const now = new Date().toISOString();

    if (conversion.kind === 'repair') {
      if (!conversion.equipmentIds.length) throw new Error('Choose at least one machine for the repair.');
      const [primary, ...others] = conversion.equipmentIds;
      const reportId = await createServiceReportDraftInTx(tx, { customerId: quotation.customer_id, equipmentId: primary, additionalEquipmentIds: others, businessDate });
      for (const item of quote.items) {
        await insertCsrItemUsage(tx, reportId, item.itemId, item.quantity, true, item.unitPriceCentavos, reason);
      }
      for (const service of quote.services) {
        await insertMachineService(tx, reportId, { equipmentId: primary, serviceId: service.serviceId, rateCentavos: service.rateCentavos, note: reason });
      }
      const statementId = await createBillingStatementDraftInTx(tx, { customerId: quotation.customer_id, serviceReportId: reportId, businessDate });
      await applyDraftDiscountInTx(tx, statementId, quotation.discount_type, quotation.discount_value);
      await tx.runAsync(
        "UPDATE quotations SET converted_kind='repair', converted_service_report_id=?, converted_billing_statement_id=?, converted_at=? WHERE id=? AND converted_kind IS NULL",
        reportId, statementId, now, quotationId,
      );
      result = { kind: 'repair', documentId: reportId, billingStatementId: statementId };
    } else {
      if (!quote.items.length) throw new Error('A delivery needs at least one inventory item, and this quotation lists only services. Convert it to a repair instead.');
      const deliveryId = await createDeliveryDraftInTx(tx, { customerId: quotation.customer_id, businessDate, notes: reason });
      for (const item of quote.items) {
        await addDeliveryItemLineInTx(tx, deliveryId, { itemId: item.itemId, quantity: item.quantity, unitPriceCentavos: item.unitPriceCentavos, overrideReason: reason });
      }
      const statementId = await createBillingStatementDraftInTx(tx, { customerId: quotation.customer_id, deliveryId, businessDate });
      for (const service of quote.services) {
        await addServiceLineInTx(tx, statementId, { serviceId: service.serviceId, rateCentavos: service.rateCentavos, overrideReason: reason });
      }
      await applyDraftDiscountInTx(tx, statementId, quotation.discount_type, quotation.discount_value);
      await tx.runAsync(
        "UPDATE quotations SET converted_kind='delivery', converted_delivery_id=?, converted_billing_statement_id=?, converted_at=? WHERE id=? AND converted_kind IS NULL",
        deliveryId, statementId, now, quotationId,
      );
      result = { kind: 'delivery', documentId: deliveryId, billingStatementId: statementId };
    }

    await appendAuditEvent(tx, {
      eventType: 'quotation.converted',
      entityType: 'quotation',
      entityId: quotationId,
      details: { kind: result.kind, documentId: result.documentId, billingStatementId: result.billingStatementId },
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });
  if (!result) throw new Error('Quotation conversion did not produce a result.');
  return result;
}
