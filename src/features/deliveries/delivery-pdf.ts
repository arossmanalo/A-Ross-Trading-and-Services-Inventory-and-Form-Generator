import type { SQLiteDatabase } from 'expo-sqlite';

import { buildDeliveryHtml, type DeliveryRenderSnapshot } from '@/features/deliveries/delivery-template';
import { finalizeDelivery, getDelivery } from '@/features/deliveries/delivery-repository';
import { renderAndStoreGeneratedPdf } from '@/features/documents/generated-pdf';
import { getBusinessLogo } from '@/features/settings/settings-repository';
import { getPreparerSignatureHtml, getSignatureCapturePreview } from '@/features/signatures/capture-repository';

function renderDeliveryPdf(db: SQLiteDatabase, deliveryId: string, dfNumber: string, html: string): Promise<string> {
  return renderAndStoreGeneratedPdf(db, { table: 'deliveries', ownerType: 'delivery', ownerId: deliveryId, number: dfNumber, html, pageSize: 'a4', eventPrefix: 'delivery' });
}

export async function finalizeAndRenderDelivery(db: SQLiteDatabase, deliveryId: string): Promise<{ dfNumber: string; pdfUri: string }> {
  const finalized = await finalizeDelivery(db, deliveryId);
  return { dfNumber: finalized.dfNumber, pdfUri: await renderDeliveryPdf(db, deliveryId, finalized.dfNumber, finalized.html) };
}

export async function retryDeliveryPdf(db: SQLiteDatabase, deliveryId: string): Promise<string> {
  const row = await db.getFirstAsync<{ df_number: string | null; render_template_snapshot: string | null; document_state: string }>(
    'SELECT df_number, render_template_snapshot, document_state FROM deliveries WHERE id = ?',
    deliveryId,
  );
  if (!row || row.document_state !== 'finalized' || !row.df_number || !row.render_template_snapshot) {
    throw new Error('Only a finalized delivery with a frozen template can be rendered.');
  }
  return renderDeliveryPdf(db, deliveryId, row.df_number, row.render_template_snapshot);
}

/** Live HTML for a draft, the frozen (or latest signed) HTML for a finalized or voided delivery. */
export async function getDeliveryPreview(db: SQLiteDatabase, deliveryId: string): Promise<{ dfNumber: string; html: string; isDraft: boolean }> {
  const delivery = await getDelivery(db, deliveryId);
  if (!delivery) throw new Error('Delivery was not found.');
  if (delivery.documentState === 'draft') {
    const business = await db.getFirstAsync<{ business_name: string; business_address: string; contact_details: string }>(
      "SELECT business_name, business_address, contact_details FROM settings WHERE id = 'business'",
    );
    if (!business) throw new Error('Business settings could not be loaded.');
    const snapshot: DeliveryRenderSnapshot = {
      preparerSignatureHtml: await getPreparerSignatureHtml(db),
      dfNumber: 'DRAFT — UNNUMBERED',
      businessDate: delivery.businessDate,
      fingerprint: 'DRAFT PREVIEW',
      business: { logoDataUrl: await getBusinessLogo(db), name: business.business_name, address: business.business_address, contactDetails: business.contact_details },
      customer: { name: delivery.customerName, address: delivery.customerAddress },
      deliveredBy: delivery.deliveredBy,
      receivedBy: delivery.receivedBy,
      notes: delivery.notes,
      lines: delivery.lines.map((line) => ({ description: line.description, quantity: line.quantity, unitLabel: line.unitLabel })),
    };
    return { dfNumber: snapshot.dfNumber, html: buildDeliveryHtml(snapshot), isDraft: true };
  }
  const row = await db.getFirstAsync<{ df_number: string | null; render_template_snapshot: string | null }>(
    'SELECT df_number, render_template_snapshot FROM deliveries WHERE id = ?',
    deliveryId,
  );
  if (!row?.df_number || !row.render_template_snapshot) throw new Error('This delivery has no frozen form to preview.');
  const signed = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM signature_captures WHERE owner_type='delivery' AND owner_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    deliveryId,
  );
  const html = signed ? (await getSignatureCapturePreview(db, signed.id)).html : row.render_template_snapshot;
  return { dfNumber: row.df_number, html, isDraft: false };
}
