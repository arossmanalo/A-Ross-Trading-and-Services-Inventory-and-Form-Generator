export const BILLING_STATEMENT_TEMPLATE_VERSION = 'billing-a4-v1';

export type BillingStatementRenderSnapshot = {
  bsNumber: string;
  businessDate: string;
  fingerprint: string;
  business: { name: string; address: string; contactDetails: string };
  customer: { name: string; address: string };
  serviceReportNumber: string | null;
  lines: Array<{ description: string; quantity: number; unitLabel: string; unitPriceCentavos: number; amountCentavos: number }>;
  subtotalCentavos: number;
  discountLabel: string | null;
  discountCentavos: number;
  totalCentavos: number;
  vatDisplayMode: 'disabled' | 'inclusive' | 'exclusive';
  vatRateBasisPoints: number;
};

const PHP_FORMATTER = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });

export function buildBillingStatementHtml(snapshot: BillingStatementRenderSnapshot): string {
  const rows = snapshot.lines.map((line) => `<tr><td>${escapeHtml(line.description)}</td><td class="number">${line.quantity} ${escapeHtml(line.unitLabel)}</td><td class="number">${money(line.unitPriceCentavos)}</td><td class="number">${money(line.amountCentavos)}</td></tr>`).join('');
  const vat = vatSummary(snapshot);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    @page{size:A4;margin:14mm 12mm 15mm}*{box-sizing:border-box}body{margin:0;color:#111827;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.35}.header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:12px;border-bottom:1px solid #1f2937}.mark{width:92px;height:54px;display:flex;align-items:center;justify-content:center;color:#073b8c;font-size:32px;font-weight:900;font-style:italic}.business{width:250px}.business-name{font-size:14px;font-weight:800}.muted{color:#4b5563;white-space:pre-line}.title{margin:15px 0 12px;color:#0b377f;font-size:19px;text-align:center;text-transform:uppercase;letter-spacing:.7px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}.meta-box{padding:8px;border-top:1px solid #374151;border-bottom:1px solid #374151}.label{display:block;color:#4b5563;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}.value{display:block;margin-top:2px;font-size:11px;font-weight:700;white-space:pre-line}table{width:100%;border-collapse:collapse}thead{display:table-header-group}th{padding:7px 5px;border-top:1px solid #1f2937;border-bottom:1px solid #1f2937;text-align:left;font-size:8px;text-transform:uppercase}td{padding:7px 5px;border-bottom:1px solid #d1d5db;vertical-align:top}.number{text-align:right;white-space:nowrap}.totals{width:280px;margin:18px 0 0 auto;break-inside:avoid}.total-row{display:flex;justify-content:space-between;padding:4px 6px;border-bottom:1px solid #9ca3af}.grand{font-size:12px;font-weight:800;border-bottom:2px solid #111827}.vat{margin-top:8px;color:#4b5563;font-size:8px;text-align:right}.footer{display:flex;justify-content:space-between;gap:18px;margin-top:28px;padding-top:8px;border-top:1px solid #d1d5db;color:#4b5563;font-size:8px;break-inside:avoid}.disclaimer{font-weight:700}.fingerprint{text-align:right;white-space:nowrap}
  </style></head><body><header class="header"><div class="mark">AR</div><div class="business"><div class="business-name">${escapeHtml(snapshot.business.name)}</div><div class="muted">${escapeHtml([snapshot.business.address,snapshot.business.contactDetails].filter(Boolean).join('\n'))}</div></div></header><h1 class="title">Billing Statement — Not a Tax Invoice</h1><section class="meta"><div class="meta-box"><span class="label">Client</span><span class="value">${escapeHtml(snapshot.customer.name)}\n${escapeHtml(snapshot.customer.address)}</span></div><div class="meta-box"><span class="label">Billing Statement</span><span class="value">${escapeHtml(snapshot.bsNumber)}\nDate ${escapeHtml(snapshot.businessDate)}${snapshot.serviceReportNumber ? `\nCSR ${escapeHtml(snapshot.serviceReportNumber)}` : ''}</span></div></section><table><thead><tr><th>Description</th><th class="number">Quantity</th><th class="number">Unit Price</th><th class="number">Amount</th></tr></thead><tbody>${rows}</tbody></table><section class="totals"><div class="total-row"><span>Subtotal</span><span>${money(snapshot.subtotalCentavos)}</span></div>${snapshot.discountCentavos ? `<div class="total-row"><span>${escapeHtml(snapshot.discountLabel ?? 'Discount')}</span><span>− ${money(snapshot.discountCentavos)}</span></div>` : ''}<div class="total-row grand"><span>Total</span><span>${money(snapshot.totalCentavos)}</span></div><div class="vat">${escapeHtml(vat)}</div></section><footer class="footer"><div class="disclaimer">This is a billing statement, not a tax invoice. All prices are VAT ${snapshot.vatDisplayMode === 'exclusive' ? 'exclusive' : snapshot.vatDisplayMode === 'inclusive' ? 'inclusive' : 'not VAT-classified'}.</div><div class="fingerprint">${escapeHtml(snapshot.bsNumber)} · ${BILLING_STATEMENT_TEMPLATE_VERSION} · ${escapeHtml(snapshot.fingerprint)}</div></footer></body></html>`;
}

function vatSummary(snapshot: BillingStatementRenderSnapshot): string {
  if (snapshot.vatDisplayMode === 'disabled') return 'VAT display disabled';
  const rate = (snapshot.vatRateBasisPoints / 100).toFixed(2).replace(/\.00$/, '');
  return `${rate}% VAT ${snapshot.vatDisplayMode}; shown for information only`;
}

function money(value: number): string { return PHP_FORMATTER.format(value / 100); }
export function escapeHtml(value: string): string { return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
