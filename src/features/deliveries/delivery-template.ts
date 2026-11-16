import { buildDocumentHeader } from '@/features/documents/document-header';
import { BILLING_FORM_CSS, escapeHtml, money } from '@/features/billing-statements/billing-statement-template';
import { applySignatureCapturesToDocument } from '@/features/signatures/signature-html';

export const DELIVERY_TEMPLATE_VERSION = 'delivery-a4-v2';

export type DeliveryRenderSnapshot = {
  preparerSignatureHtml?: string;
  dfNumber: string;
  businessDate: string;
  fingerprint: string;
  business: { logoDataUrl?: string | null; name: string; address: string; contactDetails: string };
  customer: { name: string; address: string };
  deliveredBy: string;
  receivedBy: string;
  notes: string;
  lines: Array<{ description: string; quantity: number; unitLabel: string; unitPriceCentavos: number; amountCentavos: number }>;
};

/**
 * The Delivery Form uses the same form as the Billing Statement and prints
 * prices and a total, so it can serve as the bill for the delivered items.
 */
export function buildDeliveryHtml(snapshot: DeliveryRenderSnapshot): string {
  const rows = snapshot.lines.map((line) => `<tr><td>${escapeHtml(line.description)}</td><td class="number">${line.quantity} ${escapeHtml(line.unitLabel)}</td><td class="number">${money(line.unitPriceCentavos)}</td><td class="number">${money(line.amountCentavos)}</td></tr>`).join('');
  const totalUnits = snapshot.lines.reduce((sum, line) => sum + line.quantity, 0);
  const totalCentavos = snapshot.lines.reduce((sum, line) => sum + line.amountCentavos, 0);
  const people = [snapshot.deliveredBy ? `Delivered by ${escapeHtml(snapshot.deliveredBy)}` : '', snapshot.receivedBy ? `Received by ${escapeHtml(snapshot.receivedBy)}` : ''].filter(Boolean).join('\n');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    ${BILLING_FORM_CSS}
  </style></head><body>${buildDocumentHeader(snapshot.business)}<h1 class="title">Delivery Form</h1><section class="meta"><div class="meta-box"><span class="label">Deliver to</span><span class="value">${escapeHtml(snapshot.customer.name)}\n${escapeHtml(snapshot.customer.address)}</span></div><div class="meta-box"><span class="label">Delivery</span><span class="value">${escapeHtml(snapshot.dfNumber)}\nDate ${escapeHtml(snapshot.businessDate)}${people ? `\n${people}` : ''}</span></div></section><table><thead><tr><th>Description</th><th class="number">Quantity</th><th class="number">Unit Price</th><th class="number">Total</th></tr></thead><tbody>${rows}</tbody></table><section class="totals"><div class="total-row"><span>Total quantity</span><span>${totalUnits}</span></div><div class="total-row grand"><span>Total</span><span>${money(totalCentavos)}</span></div></section>${snapshot.notes ? `<p class="delivery-notes"><strong>Notes:</strong> ${escapeHtml(snapshot.notes)}</p>` : ''}<footer class="footer"><div class="disclaimer">Please check the items on delivery. Goods received in good order and condition unless noted above.</div><div class="fingerprint">${escapeHtml(snapshot.dfNumber)} · Revision 1 · ${DELIVERY_TEMPLATE_VERSION} · ${escapeHtml(snapshot.fingerprint)}</div></footer></body></html>`;
  const signatureSection = '<section class="signatures"><div class="signature" data-signature-role="preparer"><div class="signature-writing" data-signature-image-slot="preparer"></div><div class="signature-name" data-signature-name-slot="preparer"></div><div class="signature-label">Delivered By</div></div><div class="signature" data-signature-role="customer"><div class="signature-writing" data-signature-image-slot="customer"></div><div class="signature-name" data-signature-name-slot="customer"></div><div class="signature-label">Received By (Customer)</div></div></section>';
  const withSignatures = html.replace('<footer class="footer">', `${signatureSection}<footer class="footer">`)
    .replace('</style>', 'body{overflow-wrap:anywhere}tr{break-inside:avoid}thead{display:table-header-group}.delivery-notes{margin:14px 0 0;font-size:10px}</style>');
  return applySignatureCapturesToDocument(withSignatures, [snapshot.preparerSignatureHtml ?? '']);
}
