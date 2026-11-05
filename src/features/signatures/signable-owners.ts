/**
 * Documents that can carry a signature. Data only (no imports), so any layer can
 * read it without creating a cycle. Adding a document type means adding its
 * entry here once instead of editing a ternary in every signature file.
 */
export const SIGNABLE_OWNERS = {
  service_report: {
    table: 'service_reports',
    numberColumn: 'csr_number',
    previewKind: 'csr',
    pdfPageSize: 'legal',
    label: 'CSR',
  },
  billing_statement: {
    table: 'billing_statements',
    numberColumn: 'bs_number',
    previewKind: 'billing_statement',
    pdfPageSize: 'a4',
    label: 'Billing Statement',
  },
} as const;

export type SignableOwnerType = keyof typeof SIGNABLE_OWNERS;
export type SignableOwnerInfo = (typeof SIGNABLE_OWNERS)[SignableOwnerType];
export type PreviewKind = SignableOwnerInfo['previewKind'];

export const SIGNABLE_OWNER_TYPES = Object.keys(SIGNABLE_OWNERS) as SignableOwnerType[];

export function isSignableOwnerType(value: unknown): value is SignableOwnerType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SIGNABLE_OWNERS, value);
}

export function signableOwner(ownerType: SignableOwnerType): SignableOwnerInfo {
  const owner = SIGNABLE_OWNERS[ownerType];
  if (!owner) throw new Error('Unsupported document type.');
  return owner;
}

/** The preview route's `kind` parameter back to the owner type it previews. */
export function ownerTypeForPreviewKind(kind: string | undefined): SignableOwnerType {
  const match = SIGNABLE_OWNER_TYPES.find((type) => SIGNABLE_OWNERS[type].previewKind === kind);
  return match ?? 'service_report';
}
