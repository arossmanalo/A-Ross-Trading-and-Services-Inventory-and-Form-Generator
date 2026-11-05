import type { ShareDocumentKind } from '@/features/documents/pdf-file-name';
import type { PreviewKind, SignableOwnerType } from '@/features/signatures/signable-owners';

/** What the preview screen, sharing and signing need to know about each document kind. */
export type DocumentKindInfo = {
  ownerType: SignableOwnerType;
  shareKind: ShareDocumentKind;
  label: string;
  pageSize: 'a4' | 'legal';
};

export const DOCUMENT_KINDS: Record<PreviewKind, DocumentKindInfo> = {
  csr: { ownerType: 'service_report', shareKind: 'service_report', label: 'CSR', pageSize: 'legal' },
  billing_statement: { ownerType: 'billing_statement', shareKind: 'billing_statement', label: 'Billing Statement', pageSize: 'a4' },
  quotation: { ownerType: 'quotation', shareKind: 'quotation', label: 'Quotation', pageSize: 'a4' },
};
