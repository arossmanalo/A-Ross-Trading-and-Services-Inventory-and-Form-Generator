import type { PaymentKind, PaymentMethod } from '@/features/payments/payment-types';

export const PAYMENT_ACKNOWLEDGMENT_TEMPLATE_VERSION = 'payment-a4-v2';

export type PaymentRenderSnapshot = {
  preparerSignatureHtml?: string;
  paNumber: string;
  businessDate: string;
  fingerprint: string;
  business: { logoDataUrl?: string | null; name: string; address: string; contactDetails: string };
  customer: { name: string; address: string };
  billingStatementNumber: string;
  paymentKind: PaymentKind;
  amountCentavos: number;
  method: PaymentMethod;
  referenceNumber: string;
  note: string;
  statementTotalCentavos: number;
  totalPaymentsAfterCentavos: number;
  remainingBalanceCentavos: number;
};

const PHP = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });

export function buildPaymentAcknowledgmentHtml(snapshot: PaymentRenderSnapshot): string {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    @page{size:A4;margin:18mm 16mm}*{box-sizing:border-box}body{margin:0;color:#111827;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.45}.header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:1.5px solid #1f2937}.mark{width:100px;height:65px;color:#073b8c;font-size:36px;font-weight:900;font-style:italic}.business{width:270px}.business-name{font-size:15px;font-weight:800}.muted{color:#4b5563;white-space:pre-line}.title{margin:24px 0 20px;color:#0b377f;font-size:20px;text-align:center;text-transform:uppercase;letter-spacing:.7px}.subtitle{display:block;color:#991b1b;font-size:10px;letter-spacing:1px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px}.box{padding:10px;border-top:1px solid #374151;border-bottom:1px solid #374151}.label{display:block;color:#4b5563;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}.value{display:block;margin-top:3px;font-size:12px;font-weight:700;white-space:pre-line}.amount{margin:18px 0;padding:14px;border:2px solid #0b377f;text-align:center;break-inside:avoid}.amount-label{color:#4b5563;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px}.amount-value{display:block;margin-top:5px;color:#0b377f;font-size:28px;font-weight:900}.details{width:100%;border-collapse:collapse}.details td{padding:7px;border-bottom:1px solid #d1d5db}.details td:first-child{width:42%;color:#4b5563;font-weight:700}.details td:last-child{text-align:right;font-weight:800}.balance{margin:14px 0 0 auto;width:310px;break-inside:avoid}.balance-row{display:flex;justify-content:space-between;padding:7px;border-bottom:1px solid #9ca3af}.remaining{font-size:14px;font-weight:900;border-bottom:2px solid #111827}.notice{margin-top:18px;padding:12px;background:#f3f4f6;color:#4b5563;font-size:9px;line-height:1.5}.footer{display:flex;justify-content:space-between;gap:20px;margin-top:14px;padding-top:8px;border-top:1px solid #d1d5db;color:#6b7280;font-size:8px}.fingerprint{white-space:nowrap}
  </style></head><body><header class="header"><div class="mark">${snapshot.business.logoDataUrl ? `<img alt="Business logo" src="${escapeHtml(snapshot.business.logoDataUrl)}" style="width:100%;height:100%;object-fit:contain"/>` : 'AR'}</div><div class="business"><div class="business-name">${escapeHtml(snapshot.business.name)}</div><div class="muted">${escapeHtml([snapshot.business.address,snapshot.business.contactDetails].filter(Boolean).join('\n'))}</div></div></header><h1 class="title">Payment Acknowledgment<span class="subtitle">Not a Tax Receipt</span></h1><section class="meta"><div class="box"><span class="label">Received from</span><span class="value">${escapeHtml(snapshot.customer.name)}\n${escapeHtml(snapshot.customer.address)}</span></div><div class="box"><span class="label">Acknowledgment</span><span class="value">${escapeHtml(snapshot.paNumber)}\nDate ${escapeHtml(snapshot.businessDate)}\nStatement ${escapeHtml(snapshot.billingStatementNumber)}</span></div></section><section class="amount"><span class="amount-label">Payment received</span><span class="amount-value">${money(snapshot.amountCentavos)}</span></section><table class="details"><tr><td>Payment type</td><td>${escapeHtml(kindLabel(snapshot.paymentKind))}</td></tr><tr><td>Method</td><td>${escapeHtml(methodLabel(snapshot.method))}</td></tr><tr><td>Reference</td><td>${escapeHtml(snapshot.referenceNumber || 'Not applicable')}</td></tr><tr><td>Note</td><td>${escapeHtml(snapshot.note || '-')}</td></tr></table><section class="balance"><div class="balance-row"><span>Statement total</span><span>${money(snapshot.statementTotalCentavos)}</span></div><div class="balance-row"><span>Payments received</span><span>${money(snapshot.totalPaymentsAfterCentavos)}</span></div><div class="balance-row remaining"><span>Remaining balance</span><span>${money(snapshot.remainingBalanceCentavos)}</span></div></section><div class="notice">This acknowledgment records an internal payment against the referenced Billing Statement. It is not a BIR tax receipt and does not replace the business's registered tax-document process.</div><footer class="footer"><span>${escapeHtml(snapshot.paNumber)} · Revision 1 · ${PAYMENT_ACKNOWLEDGMENT_TEMPLATE_VERSION}</span><span class="fingerprint">Fingerprint ${escapeHtml(snapshot.fingerprint)}</span></footer></body></html>`;
  return html.replace('<footer class="footer">', `${snapshot.preparerSignatureHtml ?? ''}<footer class="footer">`)
    .replace('</style>', 'body{overflow-wrap:anywhere}tr{break-inside:avoid}thead{display:table-header-group}</style>');
}

function money(value: number): string { return PHP.format(value / 100); }
function methodLabel(value: PaymentMethod): string { return ({ cash: 'Cash', bank_transfer: 'Bank Transfer', e_wallet: 'GCash / E-wallet', check: 'Check', other: 'Other' })[value]; }
function kindLabel(value: PaymentKind): string { return ({ paid_in_full: 'Paid in Full', down_payment: 'Down Payment', balance_payment: 'Remaining Balance', later_full: 'Full Payment' })[value]; }
export function escapeHtml(value: string): string { return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
