import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { printHtmlToPdf } from '@/features/documents/pdf-output';

type GeneratedPdfInput = {
  /** Document table (trusted, not user input): quotations, deliveries … */
  table: 'quotations' | 'deliveries';
  /** document_attachments.owner_type, which is also the audit entity type. */
  ownerType: 'quotation' | 'delivery';
  ownerId: string;
  number: string;
  html: string;
  pageSize: 'a4' | 'legal';
  /** Prefix of the audit events, for example 'quotation'. */
  eventPrefix: string;
};

/**
 * Renders a finalized document's frozen HTML to a PDF named after its number,
 * stores it privately, and records it as the document's generated PDF. A failure
 * marks the document's PDF as errored so it can be retried from the stored HTML.
 */
export async function renderAndStoreGeneratedPdf(db: SQLiteDatabase, input: GeneratedPdfInput): Promise<string> {
  let cacheUri: string | undefined;
  try {
    const result = await printHtmlToPdf(input.html, input.pageSize, { base64: true });
    cacheUri = result.uri;
    if (!FileSystem.documentDirectory) throw new Error('Persistent document storage is unavailable.');
    if (!result.base64) throw new Error('PDF checksum source was not returned.');
    const directory = `${FileSystem.documentDirectory}documents/`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const filename = `${input.number}.pdf`;
    const destination = `${directory}${filename}`;
    if ((await FileSystem.getInfoAsync(destination)).exists) await FileSystem.deleteAsync(destination, { idempotent: true });
    await FileSystem.writeAsStringAsync(destination, result.base64, { encoding: FileSystem.EncodingType.Base64 });
    const checksum = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, result.base64);
    const now = new Date().toISOString();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const attachment = await tx.getFirstAsync<{ id: string }>(
        "SELECT id FROM document_attachments WHERE owner_type=? AND owner_id=? AND attachment_type='generated_pdf'",
        input.ownerType, input.ownerId,
      );
      if (attachment) {
        await tx.runAsync('UPDATE document_attachments SET deterministic_filename=?, private_path=?, checksum=?, created_at=? WHERE id=?', filename, destination, checksum, now, attachment.id);
      } else {
        await tx.runAsync(
          "INSERT INTO document_attachments(id,owner_type,owner_id,attachment_type,deterministic_filename,private_path,checksum,created_at) VALUES(?,?,?,'generated_pdf',?,?,?,?)",
          Crypto.randomUUID(), input.ownerType, input.ownerId, filename, destination, checksum, now,
        );
      }
      await tx.runAsync(`UPDATE ${input.table} SET pdf_state='ready' WHERE id=?`, input.ownerId);
      await appendAuditEvent(tx, { eventType: `${input.eventPrefix}.pdf_rendered`, entityType: input.ownerType, entityId: input.ownerId, details: { numberOfPages: result.numberOfPages }, createdAt: now });
      await incrementDatabaseRevision(tx);
    });
    return destination;
  } catch (error) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      const changed = await tx.runAsync(`UPDATE ${input.table} SET pdf_state='error' WHERE id=? AND document_state='finalized'`, input.ownerId);
      if (changed.changes === 1) {
        await appendAuditEvent(tx, { eventType: `${input.eventPrefix}.pdf_error`, entityType: input.ownerType, entityId: input.ownerId, details: { message: error instanceof Error ? error.message : String(error) }, createdAt: new Date().toISOString() });
        await incrementDatabaseRevision(tx);
      }
    });
    throw error;
  } finally {
    if (cacheUri) await FileSystem.deleteAsync(cacheUri, { idempotent: true }).catch(() => undefined);
  }
}
