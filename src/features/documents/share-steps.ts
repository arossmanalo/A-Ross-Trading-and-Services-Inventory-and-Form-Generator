import * as FileSystem from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';

import { listShareableStatementsForReport, retryBillingStatementPdf, shareBillingStatementPdf } from '@/features/billing-statements/billing-statement-pdf';
import { resolveShareFileName } from '@/features/documents/share-file-name';
import type { ShareStep } from '@/features/documents/share-sequence';
import { retryServiceReportPdf, shareServiceReportPdf } from '@/features/service-reports/service-report-pdf';

async function storedPdfExists(db: SQLiteDatabase, ownerType: 'service_report' | 'billing_statement', ownerId: string): Promise<boolean> {
  const stored = await db.getFirstAsync<{ private_path: string }>(
    `SELECT private_path FROM document_attachments
     WHERE owner_type = ? AND owner_id = ? AND attachment_type = 'generated_pdf'`,
    ownerType,
    ownerId,
  );
  return Boolean(stored?.private_path && (await FileSystem.getInfoAsync(stored.private_path)).exists);
}

async function csrStep(db: SQLiteDatabase, reportId: string): Promise<ShareStep> {
  return {
    title: 'Customer Service Report',
    fileName: await resolveShareFileName(db, 'service_report', reportId),
    run: () => shareServiceReportPdf(db, reportId),
  };
}

async function statementStep(db: SQLiteDatabase, statementId: string): Promise<ShareStep> {
  return {
    title: 'Billing Statement',
    fileName: await resolveShareFileName(db, 'billing_statement', statementId),
    run: () => shareBillingStatementPdf(db, statementId),
  };
}

/**
 * Everything to hand to the share sheet for a finalized CSR: the CSR itself,
 * then each finalized Billing Statement linked to it. Missing PDFs are rendered
 * first so a failure shows before any sheet opens.
 */
export async function getServiceReportShareSteps(db: SQLiteDatabase, reportId: string): Promise<ShareStep[]> {
  const report = await db.getFirstAsync<{ document_state: string }>('SELECT document_state FROM service_reports WHERE id = ?', reportId);
  if (!report || report.document_state !== 'finalized') throw new Error('Only a finalized CSR can be shared.');
  if (!(await storedPdfExists(db, 'service_report', reportId))) await retryServiceReportPdf(db, reportId);

  const statements = await listShareableStatementsForReport(db, reportId);
  for (const statement of statements) {
    if (statement.pdfState !== 'ready' || !(await storedPdfExists(db, 'billing_statement', statement.id))) await retryBillingStatementPdf(db, statement.id);
  }
  return [await csrStep(db, reportId), ...(await Promise.all(statements.map((statement) => statementStep(db, statement.id))))];
}

/**
 * A finalized Billing Statement, followed by the finalized CSR it is billed
 * against (a draft or voided CSR is left out).
 */
export async function getBillingStatementShareSteps(db: SQLiteDatabase, statementId: string): Promise<ShareStep[]> {
  const statement = await db.getFirstAsync<{ document_state: string; service_report_id: string | null; csr_state: string | null }>(
    `SELECT b.document_state, b.service_report_id, r.document_state AS csr_state
     FROM billing_statements b LEFT JOIN service_reports r ON r.id = b.service_report_id
     WHERE b.id = ?`,
    statementId,
  );
  if (!statement || statement.document_state !== 'finalized') throw new Error('Only a finalized Billing Statement can be shared.');
  if (!(await storedPdfExists(db, 'billing_statement', statementId))) await retryBillingStatementPdf(db, statementId);

  const steps = [await statementStep(db, statementId)];
  if (statement.service_report_id && statement.csr_state === 'finalized') {
    if (!(await storedPdfExists(db, 'service_report', statement.service_report_id))) await retryServiceReportPdf(db, statement.service_report_id);
    steps.push(await csrStep(db, statement.service_report_id));
  }
  return steps;
}
