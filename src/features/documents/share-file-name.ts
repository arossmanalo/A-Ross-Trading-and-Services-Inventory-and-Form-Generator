import type { SQLiteDatabase } from 'expo-sqlite';

import { buildPdfFileName, type ShareDocumentKind } from '@/features/documents/pdf-file-name';

/**
 * File name for a shared PDF: "[Customer Name] [Code] [Date].pdf".
 *
 * Code and date are the document's own, taken from the document as issued (the
 * frozen customer name once finalized). A Billing Statement billed against a
 * finalized CSR is always sent together with that CSR in one PDF, so it takes
 * the CSR's name. `variant` marks alternate versions, for example "Signed".
 */
export async function resolveShareFileName(
  db: SQLiteDatabase,
  kind: ShareDocumentKind,
  documentId: string,
  variant?: string,
): Promise<string> {
  const { customerName, code, date } = await lookup(db, kind, documentId);
  return buildPdfFileName({ customerName, code, date, variant });
}

type Naming = { customerName: string; code: string | null; date: string };

function frozenCustomerName(snapshotJson: string | null, fallback: string): string {
  if (!snapshotJson) return fallback;
  try {
    const name = (JSON.parse(snapshotJson) as { customer?: { name?: unknown } }).customer?.name;
    return typeof name === 'string' && name.trim() ? name : fallback;
  } catch {
    return fallback;
  }
}

async function lookup(db: SQLiteDatabase, kind: ShareDocumentKind, documentId: string): Promise<Naming> {
  if (kind === 'service_report') {
    const row = await db.getFirstAsync<{ csr_number: string | null; business_date: string; snapshot: string | null; customer_name: string }>(
      `SELECT r.csr_number, r.business_date, r.content_snapshot_json AS snapshot, c.name AS customer_name
       FROM service_reports r JOIN customers c ON c.id = r.customer_id WHERE r.id = ?`,
      documentId,
    );
    if (!row) throw new Error('CSR was not found.');
    return { customerName: frozenCustomerName(row.snapshot, row.customer_name), code: row.csr_number, date: row.business_date };
  }

  if (kind === 'billing_statement') {
    const row = await db.getFirstAsync<{
      bs_number: string | null; business_date: string; snapshot: string | null; customer_name: string;
      csr_number: string | null; csr_date: string | null; csr_snapshot: string | null; csr_state: string | null;
      df_number: string | null; df_date: string | null; df_snapshot: string | null; df_state: string | null;
    }>(
      `SELECT b.bs_number, b.business_date, b.content_snapshot_json AS snapshot, c.name AS customer_name,
              r.csr_number, r.business_date AS csr_date, r.content_snapshot_json AS csr_snapshot, r.document_state AS csr_state,
              d.df_number, d.business_date AS df_date, d.content_snapshot_json AS df_snapshot, d.document_state AS df_state
       FROM billing_statements b
       JOIN customers c ON c.id = b.customer_id
       LEFT JOIN service_reports r ON r.id = b.service_report_id
       LEFT JOIN deliveries d ON d.id = b.source_delivery_id
       WHERE b.id = ?`,
      documentId,
    );
    if (!row) throw new Error('Billing statement was not found.');
    if (row.csr_state === 'finalized' && row.csr_number && row.csr_date) {
      return { customerName: frozenCustomerName(row.csr_snapshot, row.customer_name), code: row.csr_number, date: row.csr_date };
    }
    if (row.df_state === 'finalized' && row.df_number && row.df_date) {
      return { customerName: frozenCustomerName(row.df_snapshot, row.customer_name), code: row.df_number, date: row.df_date };
    }
    return { customerName: frozenCustomerName(row.snapshot, row.customer_name), code: row.bs_number, date: row.business_date };
  }

  if (kind === 'quotation') {
    const row = await db.getFirstAsync<{ qt_number: string | null; business_date: string; snapshot: string | null; customer_name: string }>(
      `SELECT q.qt_number, q.business_date, q.content_snapshot_json AS snapshot, c.name AS customer_name
       FROM quotations q JOIN customers c ON c.id = q.customer_id WHERE q.id = ?`,
      documentId,
    );
    if (!row) throw new Error('Quotation was not found.');
    return { customerName: frozenCustomerName(row.snapshot, row.customer_name), code: row.qt_number, date: row.business_date };
  }

  if (kind === 'delivery') {
    const row = await db.getFirstAsync<{ df_number: string | null; business_date: string; snapshot: string | null; customer_name: string }>(
      `SELECT d.df_number, d.business_date, d.content_snapshot_json AS snapshot, c.name AS customer_name
       FROM deliveries d JOIN customers c ON c.id = d.customer_id WHERE d.id = ?`,
      documentId,
    );
    if (!row) throw new Error('Delivery was not found.');
    return { customerName: frozenCustomerName(row.snapshot, row.customer_name), code: row.df_number, date: row.business_date };
  }

  const row = await db.getFirstAsync<{ pa_number: string | null; business_date: string; snapshot: string | null; customer_name: string }>(
    `SELECT p.pa_number, p.business_date, p.content_snapshot_json AS snapshot, c.name AS customer_name
     FROM payments p
     JOIN billing_statements b ON b.id = p.billing_statement_id
     JOIN customers c ON c.id = b.customer_id
     WHERE p.id = ?`,
    documentId,
  );
  if (!row) throw new Error('Payment was not found.');
  return { customerName: frozenCustomerName(row.snapshot, row.customer_name), code: row.pa_number, date: row.business_date };
}
