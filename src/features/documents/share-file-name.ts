import type { SQLiteDatabase } from 'expo-sqlite';

import { buildPdfFileName, type ShareDocumentKind } from '@/features/documents/pdf-file-name';

/**
 * File name for a shared PDF: "[CSR ID] [Document Type].pdf".
 *
 * A Billing Statement or Payment Acknowledgment that belongs to a CSR carries
 * that CSR's number so the documents sort together; documents with no CSR use
 * their own number. When the CSR prefix alone would repeat (several statements
 * on one CSR, or several payments) the document's own number is appended.
 * `variant` marks alternate versions, for example "Signed".
 */
export async function resolveShareFileName(
  db: SQLiteDatabase,
  kind: ShareDocumentKind,
  documentId: string,
  variant?: string,
): Promise<string> {
  const { id, suffix } = await lookup(db, kind, documentId);
  return buildPdfFileName(id, kind, [suffix, variant].filter(Boolean).join(' '));
}

async function lookup(db: SQLiteDatabase, kind: ShareDocumentKind, documentId: string): Promise<{ id: string | null; suffix: string | null }> {
  if (kind === 'service_report') {
    const row = await db.getFirstAsync<{ csr_number: string | null }>('SELECT csr_number FROM service_reports WHERE id = ?', documentId);
    if (!row) throw new Error('CSR was not found.');
    return { id: row.csr_number, suffix: null };
  }

  if (kind === 'billing_statement') {
    const row = await db.getFirstAsync<{ bs_number: string | null; csr_number: string | null; siblings: number }>(
      `SELECT b.bs_number, r.csr_number,
              (SELECT COUNT(*) FROM billing_statements x
                WHERE x.service_report_id = b.service_report_id AND x.document_state <> 'draft') AS siblings
       FROM billing_statements b
       LEFT JOIN service_reports r ON r.id = b.service_report_id
       WHERE b.id = ?`,
      documentId,
    );
    if (!row) throw new Error('Billing statement was not found.');
    if (!row.csr_number) return { id: row.bs_number, suffix: null };
    return { id: row.csr_number, suffix: row.siblings > 1 ? row.bs_number : null };
  }

  const row = await db.getFirstAsync<{ pa_number: string | null; csr_number: string | null }>(
    `SELECT p.pa_number, r.csr_number
     FROM payments p
     JOIN billing_statements b ON b.id = p.billing_statement_id
     LEFT JOIN service_reports r ON r.id = b.service_report_id
     WHERE p.id = ?`,
    documentId,
  );
  if (!row) throw new Error('Payment was not found.');
  return row.csr_number ? { id: row.csr_number, suffix: row.pa_number } : { id: row.pa_number, suffix: null };
}
