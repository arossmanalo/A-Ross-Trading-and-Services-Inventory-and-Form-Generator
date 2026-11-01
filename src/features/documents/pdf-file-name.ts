export type ShareDocumentKind = 'service_report' | 'billing_statement' | 'payment';

export const DOCUMENT_TYPE_LABELS: Record<ShareDocumentKind, string> = {
  service_report: 'Customer Service Report',
  billing_statement: 'Billing Statement',
  payment: 'Payment Acknowledgment',
};

/** Label used while a document has no number yet. */
export const DRAFT_ID_LABEL = 'DRAFT';

function cleanPart(value: string): string {
  return value
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Shared PDFs are named "[ID] [Document Type].pdf", for example
 * "CSR-000012 Billing Statement.pdf". `suffix` disambiguates documents that
 * would otherwise share a name (several statements on one CSR, or several
 * payments on one statement).
 */
export function buildPdfFileName(id: string | null | undefined, kind: ShareDocumentKind, suffix?: string | null): string {
  const parts = [cleanPart(id ?? '') || DRAFT_ID_LABEL, DOCUMENT_TYPE_LABELS[kind], cleanPart(suffix ?? '')].filter(Boolean);
  return `${parts.join(' ').slice(0, 140)}.pdf`;
}
