import type { SQLiteDatabase } from 'expo-sqlite';

import { listSignatureCaptures } from '@/features/signatures/capture-repository';
import { getSignableDocument } from '@/features/signatures/signature-repository';
import type { SignableOwnerType } from '@/features/signatures/signature-types';

/** What a document's preview should open once it has been signed. */
export type SignedPreviewTarget =
  | { kind: 'capture'; captureId: string }
  | { kind: 'attachment'; uri: string };

/**
 * The latest in-person signed version if there is one, otherwise the latest
 * customer-returned signed PDF. Null while the document is unsigned.
 */
export async function getSignedPreviewTarget(db: SQLiteDatabase, ownerType: SignableOwnerType, ownerId: string): Promise<SignedPreviewTarget | null> {
  const captures = await listSignatureCaptures(db, ownerType, ownerId);
  if (captures[0]) return { kind: 'capture', captureId: captures[0].id };
  const document = await getSignableDocument(db, ownerType, ownerId);
  const attachment = document?.attachments[0];
  return attachment ? { kind: 'attachment', uri: attachment.privatePath } : null;
}
