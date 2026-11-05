import * as FileSystem from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { listShareableStatementsForReport, retryBillingStatementPdf } from '@/features/billing-statements/billing-statement-pdf';
import { resolveShareFileName } from '@/features/documents/share-file-name';
import { sharePdfFiles } from '@/features/documents/share-pdf';
import { retryQuotationPdf } from '@/features/quotations/quotation-pdf';
import { retryServiceReportPdf } from '@/features/service-reports/service-report-pdf';

type BundleDocument = { kind: 'service_report' | 'billing_statement' | 'quotation'; id: string };

/** Table and audit event for each document kind that can go into a shared PDF. */
const BUNDLE_KINDS = {
  service_report: { table: 'service_reports', event: 'csr.share_sheet_opened' },
  billing_statement: { table: 'billing_statements', event: 'billing_statement.share_sheet_opened' },
  quotation: { table: 'quotations', event: 'quotation.share_sheet_opened' },
} as const;

/** One PDF to send: the pages of every included document, in order. */
export type ShareBundle = {
  fileName: string;
  sourceUris: string[];
  documents: BundleDocument[];
};

/** Path of a document's stored PDF, rendering it first if it is missing. */
async function readyPdf(db: SQLiteDatabase, document: BundleDocument): Promise<string> {
  const stored = await db.getFirstAsync<{ private_path: string }>(
    `SELECT private_path FROM document_attachments
     WHERE owner_type = ? AND owner_id = ? AND attachment_type = 'generated_pdf'`,
    document.kind,
    document.id,
  );
  if (stored?.private_path && (await FileSystem.getInfoAsync(stored.private_path)).exists) return stored.private_path;
  if (document.kind === 'service_report') return retryServiceReportPdf(db, document.id);
  return document.kind === 'billing_statement' ? retryBillingStatementPdf(db, document.id) : retryQuotationPdf(db, document.id);
}

async function buildBundle(db: SQLiteDatabase, primary: BundleDocument, documents: BundleDocument[]): Promise<ShareBundle> {
  const sourceUris: string[] = [];
  for (const document of documents) sourceUris.push(await readyPdf(db, document));
  return { fileName: await resolveShareFileName(db, primary.kind, primary.id), sourceUris, documents };
}

/**
 * A finalized CSR is sent as one PDF: the CSR first, then each finalized
 * Billing Statement linked to it. A CSR with no statement is sent alone.
 */
export async function getServiceReportShareBundle(db: SQLiteDatabase, reportId: string): Promise<ShareBundle> {
  const report = await db.getFirstAsync<{ document_state: string }>('SELECT document_state FROM service_reports WHERE id = ?', reportId);
  if (!report || report.document_state !== 'finalized') throw new Error('Only a finalized CSR can be shared.');
  const statements = await listShareableStatementsForReport(db, reportId);
  const primary: BundleDocument = { kind: 'service_report', id: reportId };
  return buildBundle(db, primary, [primary, ...statements.map((statement): BundleDocument => ({ kind: 'billing_statement', id: statement.id }))]);
}

/** A finalized quotation is sent on its own. */
export async function getQuotationShareBundle(db: SQLiteDatabase, quotationId: string): Promise<ShareBundle> {
  const quotation = await db.getFirstAsync<{ document_state: string }>('SELECT document_state FROM quotations WHERE id = ?', quotationId);
  if (!quotation || quotation.document_state !== 'finalized') throw new Error('Only a finalized quotation can be shared.');
  const own: BundleDocument = { kind: 'quotation', id: quotationId };
  return buildBundle(db, own, [own]);
}

/**
 * A finalized Billing Statement billed against a finalized CSR is sent as one
 * PDF with the CSR first and the statement second. Without a CSR (or with a
 * draft or voided one) the statement is sent alone.
 */
export async function getBillingStatementShareBundle(db: SQLiteDatabase, statementId: string): Promise<ShareBundle> {
  const statement = await db.getFirstAsync<{ document_state: string; service_report_id: string | null; csr_state: string | null }>(
    `SELECT b.document_state, b.service_report_id, r.document_state AS csr_state
     FROM billing_statements b LEFT JOIN service_reports r ON r.id = b.service_report_id
     WHERE b.id = ?`,
    statementId,
  );
  if (!statement || statement.document_state !== 'finalized') throw new Error('Only a finalized Billing Statement can be shared.');
  const own: BundleDocument = { kind: 'billing_statement', id: statementId };
  const documents: BundleDocument[] = statement.service_report_id && statement.csr_state === 'finalized'
    ? [{ kind: 'service_report', id: statement.service_report_id }, own]
    : [own];
  return buildBundle(db, own, documents);
}

/** Opens the share sheet, then records that each included document was shared. */
export async function shareBundle(db: SQLiteDatabase, bundle: ShareBundle): Promise<void> {
  await sharePdfFiles({ sourceUris: bundle.sourceUris, fileName: bundle.fileName });
  await db.withExclusiveTransactionAsync(async (tx) => {
    const now = new Date().toISOString();
    for (const document of bundle.documents) {
      const { table, event } = BUNDLE_KINDS[document.kind];
      await tx.runAsync(`UPDATE ${table} SET share_state = 'shared' WHERE id = ?`, document.id);
      await appendAuditEvent(tx, {
        eventType: event,
        entityType: document.kind,
        entityId: document.id,
        details: { sentWithDocuments: bundle.documents.length },
        createdAt: now,
      });
    }
    await incrementDatabaseRevision(tx);
  });
}
