import { buildDocumentHeader, DOCUMENT_HEADER_CSS } from '@/features/documents/document-header';
import { applySignatureCapturesToDocument } from '@/features/signatures/signature-html';

export const CSR_TEMPLATE_VERSION = 'csr-legal-v8';

export type CsrRenderSnapshot = {
  preparerSignatureHtml?: string;
  includeSignatureLines?: boolean;
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
  /** Every machine serviced on this CSR. `equipment` is the primary machine. */
  machines?: Array<{
    machineType: string;
    model: string;
    serialNumber: string;
    nicknameOrLocation: string;
  }>;
  /** Services are billed once per machine. Omitted on older snapshots (one machine). */
  machineCount?: number;
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
  /**
   * One entry per service per machine. Entries from earlier template versions
   * have no machine fields and keep the single-rate (or rate x machines) layout.
   */
  services?: Array<{
    description: string;
    rateCentavos: number;
    machineLabel?: string;
    /** 1-based position of the machine in `machines`. */
    machineNumber?: number;
    note?: string;
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
    ${DOCUMENT_HEADER_CSS}
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
    .footer { margin-top: 18px; color: #64748b; font-size: 7px; text-align: center; }
  </style>
</head>
<body>
  ${buildDocumentHeader(snapshot.business)}
  <h1>Customer Service Report</h1>
  <section class="grid">
    ${cell('Customer Name', snapshot.customer.name, true)}
    ${cell('Address', snapshot.customer.address)}
    ${cell('Date', snapshot.businessDate)}
    ${machineCells(snapshot)}
  </section>
  ${listSection('Reported Problem', snapshot.reportedProblem)}
  ${listSection('Diagnosis', snapshot.diagnosis)}
  ${listSection('Action Taken', snapshot.actionTaken)}
  <section class="section"><div class="section-title">Status After Service</div><div class="status">${outcomes}</div></section>
  ${listSection('Recommendations', snapshot.recommendations)}
  ${textSection('Machine Status', snapshot.machineStatus)}
  ${listSection('Billing', snapshot.billing)}
  ${usageSection(snapshot.usages)}
  ${serviceSection(snapshot.services, snapshot.machineCount ?? 1)}
  ${textSection('Warranty', snapshot.warrantyText)}
  ${listSection("Customer's Remarks", snapshot.customerRemarks)}
  <div class="total-row"><div class="total-box"><span>Total Bill</span><span>${escapeHtml(PHP_FORMATTER.format(snapshot.totalBillCentavos / 100))}</span></div></div>
  ${snapshot.includeSignatureLines === false ? '' : `<section class="signatures">
    <div class="signature" data-signature-role="preparer"><div class="signature-writing" data-signature-image-slot="preparer"></div><div class="signature-name" data-signature-name-slot="preparer">${escapeHtml(snapshot.servicedBy)}</div><div class="signature-label">Serviced By</div></div>
    <div class="signature" data-signature-role="customer"><div class="signature-writing" data-signature-image-slot="customer"></div><div class="signature-name" data-signature-name-slot="customer">${escapeHtml(snapshot.acknowledgedBy)}</div><div class="signature-label">Acknowledged By</div></div>
  </section>`}
  <footer class="footer">${escapeHtml(snapshot.csrNumber)} | Revision 1 | Template ${CSR_TEMPLATE_VERSION} | Fingerprint ${escapeHtml(snapshot.fingerprint)}</footer>
</body>
</html>`;
  const preparedHtml = html.replace('</style>', 'body{overflow-wrap:anywhere}tr{break-inside:avoid}thead{display:table-header-group}</style>');
  return snapshot.includeSignatureLines === false
    ? preparedHtml
    : applySignatureCapturesToDocument(preparedHtml, [snapshot.preparerSignatureHtml ?? '']);
}

function machineLabel(machine: { machineType: string; nicknameOrLocation: string }): string {
  return [machine.machineType, machine.nicknameOrLocation].filter(Boolean).join(' - ');
}

/** One machine keeps the sample's Machine/CSR No./Model/Serial layout; several machines get their own numbered rows. */
function machineCells(snapshot: CsrRenderSnapshot): string {
  const machines = snapshot.machines && snapshot.machines.length > 1 ? snapshot.machines : null;
  if (!machines) {
    return [
      cell('Machine', machineLabel(snapshot.equipment)),
      cell('CSR No.', snapshot.csrNumber),
      cell('Model', snapshot.equipment.model),
      cell('Serial No.', snapshot.equipment.serialNumber),
    ].join('');
  }
  return [
    cell('CSR No.', snapshot.csrNumber, true),
    ...machines.map((machine, index) => cell(
      `Machine ${index + 1} of ${machines.length}`,
      [machineLabel(machine), machine.model && `Model ${machine.model}`, machine.serialNumber && `Serial ${machine.serialNumber}`].filter(Boolean).join(' | '),
      true,
    )),
  ].join('');
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
  return `<section class="section"><div class="section-title">Items Used</div><table class="usage-table"><thead><tr><th>Description</th><th class="qty">Qty used</th></tr></thead><tbody>${usages
    .map((usage) => `<tr><td>${escapeHtml(usage.description)}${usage.billable ? '' : ' (non-billable)'}</td><td class="qty">${usage.quantity} ${escapeHtml(usage.unitLabel)}</td></tr>`)
    .join('')}</tbody></table></section>`;
}

function serviceSection(services: CsrRenderSnapshot['services'] = [], machineCount = 1): string {
  if (!services.length) return '';
  if (services.some((service) => service.machineLabel !== undefined)) return perMachineServiceSection(services);
  if (machineCount <= 1) {
    return `<section class="section"><div class="section-title">Services Used</div><table class="usage-table"><thead><tr><th>Description</th><th class="qty">Rate</th></tr></thead><tbody>${services
      .map((service) => `<tr><td>${escapeHtml(service.description)}</td><td class="qty">${escapeHtml(PHP_FORMATTER.format(service.rateCentavos / 100))}</td></tr>`)
      .join('')}</tbody></table></section>`;
  }
  return `<section class="section"><div class="section-title">Services Used (per machine &times; ${machineCount} machines)</div><table class="usage-table"><thead><tr><th>Description</th><th class="qty">Rate</th><th class="qty">Machines</th><th class="qty">Amount</th></tr></thead><tbody>${services
    .map((service) => `<tr><td>${escapeHtml(service.description)}</td><td class="qty">${escapeHtml(PHP_FORMATTER.format(service.rateCentavos / 100))}</td><td class="qty">&times; ${machineCount}</td><td class="qty">${escapeHtml(PHP_FORMATTER.format((service.rateCentavos * machineCount) / 100))}</td></tr>`)
    .join('')}</tbody></table></section>`;
}

/** Services grouped under their machine, each priced individually, with a subtotal per machine. */
function perMachineServiceSection(services: NonNullable<CsrRenderSnapshot['services']>): string {
  const groups = new Map<number, { label: string; rows: typeof services }>();
  for (const service of services) {
    const number = service.machineNumber ?? 1;
    const group = groups.get(number) ?? { label: service.machineLabel ?? `Machine ${number}`, rows: [] };
    group.rows.push(service);
    groups.set(number, group);
  }
  const tables = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([number, group]) => {
    const subtotal = group.rows.reduce((sum, row) => sum + row.rateCentavos, 0);
    const rows = group.rows
      .map((row) => `<tr><td>${escapeHtml(row.description)}${row.note ? ` <span class="note">(${escapeHtml(row.note)})</span>` : ''}</td><td class="qty">${escapeHtml(PHP_FORMATTER.format(row.rateCentavos / 100))}</td></tr>`)
      .join('');
    return `<table class="usage-table"><thead><tr><th colspan="2">Machine ${number}: ${escapeHtml(group.label)}</th></tr></thead><tbody>${rows}<tr><td><strong>Machine subtotal</strong></td><td class="qty"><strong>${escapeHtml(PHP_FORMATTER.format(subtotal / 100))}</strong></td></tr></tbody></table>`;
  });
  return `<section class="section"><div class="section-title">Services Used</div>${tables.join('')}</section>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
