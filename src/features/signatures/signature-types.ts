import type { SignableOwnerType } from '@/features/signatures/signable-owners';

export type { SignableOwnerType };
export type SignatureStatus = 'not_required' | 'pending' | 'signed_in_person' | 'signed_document_attached' | 'declined' | 'no_response';

export type SignedAttachment = {
  id: string;
  filename: string;
  privatePath: string;
  checksum: string;
  createdAt: string;
};

export type SignableDocument = {
  ownerType: SignableOwnerType;
  ownerId: string;
  documentNumber: string;
  customerName: string;
  fingerprint: string;
  signatureStatus: SignatureStatus;
  documentState: 'draft' | 'finalized' | 'voided';
  attachments: SignedAttachment[];
};
