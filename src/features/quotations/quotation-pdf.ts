import type { SQLiteDatabase } from 'expo-sqlite';

import { renderAndStoreGeneratedPdf } from '@/features/documents/generated-pdf';
import { finalizeQuotation, getQuotation } from '@/features/quotations/quotation-repository';
import { buildQuotationHtml, type QuotationRenderSnapshot } from '@/features/quotations/quotation-template';
import { getBusinessLogo } from '@/features/settings/settings-repository';
import { getPreparerSignatureHtml, getSignatureCapturePreview } from '@/features/signatures/capture-repository';

function renderQuotationPdf(db: SQLiteDatabase, quotationId: string, qtNumber: string, html: string): Promise<string> {
  return renderAndStoreGeneratedPdf(db, { table: 'quotations', ownerType: 'quotation', ownerId: quotationId, number: qtNumber, html, pageSize: 'a4', eventPrefix: 'quotation' });
}

export async function finalizeAndRenderQuotation(db: SQLiteDatabase, quotationId: string): Promise<{ qtNumber: string; pdfUri: string }> {
  const finalized = await finalizeQuotation(db, quotationId);
  return { qtNumber: finalized.qtNumber, pdfUri: await renderQuotationPdf(db, quotationId, finalized.qtNumber, finalized.html) };
}

export async function retryQuotationPdf(db: SQLiteDatabase, quotationId: string): Promise<string> {
  const row = await db.getFirstAsync<{ qt_number: string | null; render_template_snapshot: string | null; document_state: string }>(
    'SELECT qt_number, render_template_snapshot, document_state FROM quotations WHERE id = ?',
    quotationId,
  );
  if (!row || row.document_state !== 'finalized' || !row.qt_number || !row.render_template_snapshot) {
    throw new Error('Only a finalized quotation with a frozen template can be rendered.');
  }
  return renderQuotationPdf(db, quotationId, row.qt_number, row.render_template_snapshot);
}

/** Live HTML for a draft, the frozen (or latest signed) HTML for a finalized quotation. */
export async function getQuotationPreview(db: SQLiteDatabase, quotationId: string): Promise<{ qtNumber: string; html: string; isDraft: boolean }> {
  const quotation = await getQuotation(db, quotationId);
  if (!quotation) throw new Error('Quotation was not found.');
  if (quotation.documentState === 'draft') {
    const business = await db.getFirstAsync<{ business_name: string; business_address: string; contact_details: string; vat_display_mode: QuotationRenderSnapshot['vatDisplayMode']; vat_rate_basis_points: number }>(
      "SELECT business_name, business_address, contact_details, vat_display_mode, vat_rate_basis_points FROM settings WHERE id = 'business'",
    );
    if (!business) throw new Error('Business settings could not be loaded.');
    const unitRows = await db.getAllAsync<{ id: string; unit_label: string | null }>(
      'SELECT l.id, i.unit_label FROM quotation_lines l LEFT JOIN items i ON i.id = l.item_id WHERE l.quotation_id = ?',
      quotationId,
    );
    const unitLabels = new Map(unitRows.map((line) => [line.id, line.unit_label]));
    const discountCentavos = quotation.subtotalCentavos - quotation.totalCentavos;
    const snapshot: QuotationRenderSnapshot = {
      preparerSignatureHtml: await getPreparerSignatureHtml(db),
      qtNumber: 'DRAFT — UNNUMBERED',
      businessDate: quotation.businessDate,
      validUntil: quotation.validUntil,
      fingerprint: 'DRAFT PREVIEW',
      business: { logoDataUrl: await getBusinessLogo(db), name: business.business_name, address: business.business_address, contactDetails: business.contact_details },
      customer: { name: quotation.customerName, address: quotation.customerAddress },
      lines: quotation.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitLabel: line.lineType === 'item' ? unitLabels.get(line.id) || 'pc' : 'service',
        unitPriceCentavos: line.unitPriceCentavos,
        amountCentavos: line.amountCentavos,
      })),
      subtotalCentavos: quotation.subtotalCentavos,
      discountLabel: quotation.discountType === 'fixed' ? 'Discount' : quotation.discountType === 'percentage' ? `Discount (${(quotation.discountValue / 100).toFixed(2).replace(/\.00$/, '')}%)` : null,
      discountCentavos,
      totalCentavos: quotation.totalCentavos,
      vatDisplayMode: business.vat_display_mode,
      vatRateBasisPoints: business.vat_rate_basis_points,
    };
    return { qtNumber: snapshot.qtNumber, html: buildQuotationHtml(snapshot), isDraft: true };
  }
  const row = await db.getFirstAsync<{ qt_number: string | null; render_template_snapshot: string | null; document_state: string }>(
    'SELECT qt_number, render_template_snapshot, document_state FROM quotations WHERE id = ?',
    quotationId,
  );
  if (!row?.qt_number || !row.render_template_snapshot || row.document_state === 'draft') throw new Error('Only a draft or finalized quotation can be previewed.');
  const signed = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM signature_captures WHERE owner_type='quotation' AND owner_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    quotationId,
  );
  const html = signed ? (await getSignatureCapturePreview(db, signed.id)).html : row.render_template_snapshot;
  return { qtNumber: row.qt_number, html, isDraft: false };
}
