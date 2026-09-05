export const CSR_TEMPLATE_VERSION = 'csr-legal-v2';

export type CsrRenderSnapshot = {
  preparerSignatureHtml?: string;
  csrNumber: string;
  businessDate: string;
  fingerprint: string;
  business: {
    logoDataUrl?: string | null;
    name: string;
    address: string;
    contactDetails: string;
  };
  customer: {
    name: string;
    address: string;
  };
  equipment: {
    machineType: string;
    model: string;
    serialNumber: string;
    nicknameOrLocation: string;
  };
  serviceOutcome: string;
  reportedProblem: string[];
  diagnosis: string[];
  actionTaken: string[];
  recommendations: string[];
  billing: string[];
  customerRemarks: string[];
  machineStatus: string;
  warrantyText: string;
  servicedBy: string;
  acknowledgedBy: string;
  totalBillCentavos: number;
  usages: Array<{
    description: string;
    quantity: number;
    unitLabel: string;
    billable: boolean;
  }>;
};

const PHP_FORMATTER = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
});

export function buildCsrHtml(snapshot: CsrRenderSnapshot): string {
  const outcomeLabels: Record<string, string> = {
    completed: 'Completed',
    incomplete: 'Incomplete',
    waiting_for_parts: 'Waiting for parts',
    under_observation: 'Under observation',
  };
  const outcomes = Object.entries(outcomeLabels)
    .map(([value, label]) => `<span class="choice">${snapshot.serviceOutcome === value ? '&#9745;' : '&#9744;'} ${escapeHtml(label)}</span>`)
    .join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    @page { size: 8.5in 14in; margin: 0.35in; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 10px; line-height: 1.35; }
    .header { text-align: center; padding-bottom: 10px; border-bottom: 1.5px solid #0b377f; }
    .mark { display: inline-flex; align-items: center; justify-content: center; width: 58px; height: 42px; margin-bottom: 4px; color: #0b377f; font-size: 25px; font-weight: 900; font-style: italic; }
    .business { font-size: 16px; font-weight: 800; }
    .contact { color: #374151; font-size: 9px; white-space: pre-line; }
    h1 { margin: 10px 0 8px; color: #0b377f; font-size: 16px; text-align: center; text-transform: uppercase; letter-spacing: 1px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #334155; }
    .cell { min-height: 34px; padding: 5px 7px; border-right: 1px solid #64748b; border-bottom: 1px solid #64748b; }
    .cell:nth-child(2n) { border-right: 0; }
    .cell.full { grid-column: 1 / -1; border-right: 0; }
    .label { display: block; color: #475569; font-size: 7.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }
    .value { display: block; padding-top: 2px; font-size: 10px; font-weight: 600; white-space: pre-wrap; }
    .section { break-inside: avoid; border: 1px solid #334155; border-top: 0; }
    .section-title { padding: 4px 7px; background: #eaf2ff; color: #0b377f; font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; }
    .section-body { min-height: 34px; padding: 6px 8px; white-space: pre-wrap; }
    .section-body ul { margin: 0; padding-left: 15px; }
    .status { display: flex; flex-wrap: wrap; gap: 12px; padding: 7px 8px; }
    .choice { white-space: nowrap; }
    .usage-table { width: 100%; border-collapse: collapse; }
    .usage-table th, .usage-table td { padding: 4px 6px; border-top: 1px solid #94a3b8; text-align: left; }
    .usage-table th { color: #475569; font-size: 7.5px; text-transform: uppercase; }
    .usage-table .qty { width: 22%; text-align: right; }
    .total-row { display: flex; justify-content: flex-end; padding: 10px 0; }
    .total-box { width: 240px; padding: 7px 10px; border: 1.5px solid #0b377f; display: flex; justify-content: space-between; font-size: 12px; font-weight: 800; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 36px; margin-top: 34px; break-inside: avoid; }
    .signature { padding-top: 6px; border-top: 1px solid #111827; text-align: center; }
    .signature-name { min-height: 18px; font-weight: 700; }
    .signature-label { color: #475569; font-size: 8px; text-transform: uppercase; }
    .footer { margin-top: 18px; color: #64748b; font-size: 7px; text-align: center; }
  </style>
</head>
<body>
  <header class="header">
    <div class="mark">${snapshot.business.logoDataUrl ? `<img alt="Business logo" src="${escapeHtml(snapshot.business.logoDataUrl)}" style="width:100%;height:100%;object-fit:contain"/>` : 'AR'}</div>
    <div class="business">${escapeHtml(snapshot.business.name)}</div>
    <div class="contact">${escapeHtml([snapshot.business.address, snapshot.business.contactDetails].filter(Boolean).join('\n'))}</div>
  </header>
  <h1>Customer Service Report</h1>
  <section class="grid">
    ${cell('Customer Name', snapshot.customer.name, true)}
    ${cell('Address', snapshot.customer.address)}
    ${cell('Date', snapshot.businessDate)}
    ${cell('Machine', [snapshot.equipment.machineType, snapshot.equipment.nicknameOrLocation].filter(Boolean).join(' - '))}
    ${cell('CSR No.', snapshot.csrNumber)}
    ${cell('Model', snapshot.equipment.model)}
    ${cell('Serial No.', snapshot.equipment.serialNumber)}
  </section>
  ${listSection('Reported Problem', snapshot.reportedProblem)}
  ${listSection('Diagnosis', snapshot.diagnosis)}
  ${listSection('Action Taken', snapshot.actionTaken)}
  <section class="section"><div class="section-title">Status After Service</div><div class="status">${outcomes}</div></section>
  ${listSection('Recommendations', snapshot.recommendations)}
  ${textSection('Machine Status', snapshot.machineStatus)}
  ${listSection('Billing', snapshot.billing)}
  ${usageSection(snapshot.usages)}
  ${textSection('Warranty', snapshot.warrantyText)}
  ${listSection("Customer's Remarks", snapshot.customerRemarks)}
  <div class="total-row"><div class="total-box"><span>Total Bill</span><span>${escapeHtml(PHP_FORMATTER.format(snapshot.totalBillCentavos / 100))}</span></div></div>
  <section class="signatures">
    <div class="signature"><div class="signature-name">${escapeHtml(snapshot.servicedBy)}</div><div class="signature-label">Serviced By</div></div>
    <div class="signature"><div class="signature-name">${escapeHtml(snapshot.acknowledgedBy)}</div><div class="signature-label">Acknowledged By</div></div>
  </section>
  <footer class="footer">${escapeHtml(snapshot.csrNumber)} | Revision 1 | Template ${CSR_TEMPLATE_VERSION} | Fingerprint ${escapeHtml(snapshot.fingerprint)}</footer>
</body>
</html>`;
  return html.replace('<footer class="footer">', `${snapshot.preparerSignatureHtml ?? ''}<footer class="footer">`)
    .replace('</style>', 'body{overflow-wrap:anywhere}tr{break-inside:avoid}thead{display:table-header-group}</style>');
}

function cell(label: string, value: string, full = false): string {
  return `<div class="cell${full ? ' full' : ''}"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value || '-')}</span></div>`;
}

function listSection(title: string, entries: string[]): string {
  const minimumRows = title === 'Recommendations' || title === "Customer's Remarks" ? 2 : 3;
  const content = entries.length
    ? `<ul>${entries.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>`
    : '-';
  return `<section class="section"><div class="section-title">${escapeHtml(title)}</div><div class="section-body" style="min-height:${minimumRows * 16}px">${content}</div></section>`;
}

function textSection(title: string, value: string): string {
  return `<section class="section"><div class="section-title">${escapeHtml(title)}</div><div class="section-body">${escapeHtml(value || '-')}</div></section>`;
}

function usageSection(usages: CsrRenderSnapshot['usages']): string {
  if (!usages.length) return '';
  return `<section class="section"><div class="section-title">Items Used</div><table class="usage-table"><thead><tr><th>Description</th><th class="qty">Quantity</th></tr></thead><tbody>${usages
    .map((usage) => `<tr><td>${escapeHtml(usage.description)}${usage.billable ? '' : ' (non-billable)'}</td><td class="qty">${usage.quantity} ${escapeHtml(usage.unitLabel)}</td></tr>`)
    .join('')}</tbody></table></section>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
