export type ShareDocumentKind = 'service_report' | 'billing_statement' | 'payment';

/** Label used while a document has no number yet. */
export const DRAFT_ID_LABEL = 'DRAFT';

const MAX_CUSTOMER_LENGTH = 60;

function cleanPart(value: string): string {
  return value
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Shared PDFs are named "[Customer Name] [Code] [Date].pdf", for example
 * "Juan Dela Cruz CSR-000012 2026-09-05.pdf". `variant` marks alternate
 * versions such as "Signed".
 */
export function buildPdfFileName(parts: { customerName: string; code: string | null | undefined; date: string; variant?: string | null }): string {
  const customer = cleanPart(parts.customerName).slice(0, MAX_CUSTOMER_LENGTH).trim() || 'Customer';
  const code = cleanPart(parts.code ?? '') || DRAFT_ID_LABEL;
  return `${[customer, code, cleanPart(parts.date), cleanPart(parts.variant ?? '')].filter(Boolean).join(' ')}.pdf`;
}
