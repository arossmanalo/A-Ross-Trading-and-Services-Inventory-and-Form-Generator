import { buildDocumentHeader } from '@/features/documents/document-header';
import { BILLING_FORM_CSS, escapeHtml } from '@/features/billing-statements/billing-statement-template';
import { applySignatureCapturesToDocument } from '@/features/signatures/signature-html';

export const QUOTATION_TEMPLATE_VERSION = 'quotation-a4-v1';

export type QuotationRenderSnapshot = {
  preparerSignatureHtml?: string;
  qtNumber: string;
  businessDate: string;
  validUntil: string;
  fingerprint: string;
  business: { logoDataUrl?: string | null; name: string; address: string; contactDetails: string };
  customer: { name: string; address: string };
  lines: Array<{ description: string; quantity: number; unitLabel: string; unitPriceCentavos: number; amountCentavos: number }>;
  subtotalCentavos: number;
  discountLabel: string | null;
  discountCentavos: number;
  totalCentavos: number;
  vatDisplayMode: 'disabled' | 'inclusive' | 'exclusive';
  vatRateBasisPoints: number;
};

const PHP_FORMATTER = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });

/** The Quotation uses the Billing Statement's form: same header, boxes, table and totals, without payments. */
export function buildQuotationHtml(snapshot: QuotationRenderSnapshot): string {
  const rows = snapshot.lines.map((line) => `<tr><td>${escapeHtml(line.description)}</td><td class="number">${line.quantity} ${escapeHtml(line.unitLabel)}</td><td class="number">${money(line.unitPriceCentavos)}</td><td class="number">${money(line.amountCentavos)}</td></tr>`).join('');
  const vat = vatSummary(snapshot);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    ${BILLING_FORM_CSS}
  </style></head><body>${buildDocumentHeader(snapshot.business)}<h1 class="title">Quotation</h1><section class="meta"><div class="meta-box"><span class="label">Client</span><span class="value">${escapeHtml(snapshot.customer.name)}\n${escapeHtml(snapshot.customer.address)}</span></div><div class="meta-box"><span class="label">Quotation</span><span class="value">${escapeHtml(snapshot.qtNumber)}\nDate ${escapeHtml(snapshot.businessDate)}\nValid until ${escapeHtml(snapshot.validUntil)}</span></div></section><table><thead><tr><th>Description</th><th class="number">Quantity</th><th class="number">Unit Price</th><th class="number">Amount</th></tr></thead><tbody>${rows}</tbody></table><section class="totals"><div class="total-row"><span>Subtotal</span><span>${money(snapshot.subtotalCentavos)}</span></div>${snapshot.discountCentavos ? `<div class="total-row"><span>${escapeHtml(snapshot.discountLabel ?? 'Discount')}</span><span>− ${money(snapshot.discountCentavos)}</span></div>` : ''}<div class="total-row grand"><span>Total</span><span>${money(snapshot.totalCentavos)}</span></div><div class="vat">${escapeHtml(vat)}</div></section><footer class="footer"><div class="disclaimer">This is a quotation, not a billing statement or tax invoice. Prices are valid until ${escapeHtml(snapshot.validUntil)}. All prices are VAT ${snapshot.vatDisplayMode === 'exclusive' ? 'exclusive' : snapshot.vatDisplayMode === 'inclusive' ? 'inclusive' : 'not VAT-classified'}.</div><div class="fingerprint">${escapeHtml(snapshot.qtNumber)} · Revision 1 · ${QUOTATION_TEMPLATE_VERSION} · ${escapeHtml(snapshot.fingerprint)}</div></footer></body></html>`;
  const signatureSection = '<section class="signatures"><div class="signature" data-signature-role="preparer"><div class="signature-writing" data-signature-image-slot="preparer"></div><div class="signature-name" data-signature-name-slot="preparer"></div><div class="signature-label">Prepared By</div></div><div class="signature" data-signature-role="customer"><div class="signature-writing" data-signature-image-slot="customer"></div><div class="signature-name" data-signature-name-slot="customer"></div><div class="signature-label">Customer Conforme</div></div></section>';
  const withSignatures = html.replace('<footer class="footer">', `${signatureSection}<footer class="footer">`)
    .replace('</style>', 'body{overflow-wrap:anywhere}tr{break-inside:avoid}thead{display:table-header-group}</style>');
  return applySignatureCapturesToDocument(withSignatures, [snapshot.preparerSignatureHtml ?? '']);
}

function vatSummary(snapshot: QuotationRenderSnapshot): string {
  if (snapshot.vatDisplayMode === 'disabled') return 'VAT display disabled';
  const rate = (snapshot.vatRateBasisPoints / 100).toFixed(2).replace(/\.00$/, '');
  return `${rate}% VAT ${snapshot.vatDisplayMode}; shown for information only`;
}

function money(value: number): string { return PHP_FORMATTER.format(value / 100); }
