import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { finalizeServiceReport } from '@/features/service-reports/service-report-repository';

const LEGAL_WIDTH_POINTS = 612;
const LEGAL_HEIGHT_POINTS = 1008;

export async function finalizeAndRenderServiceReport(
  db: SQLiteDatabase,
  reportId: string,
  pricePolicy: 'keep-draft' | 'reject' | 'use-current' = 'reject',
): Promise<{ csrNumber: string; pdfUri: string }> {
  const finalized = await finalizeServiceReport(db, reportId, pricePolicy);
  const pdfUri = await renderFinalizedServiceReportPdf(db, reportId, finalized.csrNumber, finalized.html);
  return { csrNumber: finalized.csrNumber, pdfUri };
}

export async function retryServiceReportPdf(
  db: SQLiteDatabase,
  reportId: string,
): Promise<string> {
  const row = await db.getFirstAsync<{
    csr_number: string | null;
    render_template_snapshot: string | null;
    document_state: string;
  }>(
    'SELECT csr_number, render_template_snapshot, document_state FROM service_reports WHERE id = ?',
    reportId,
  );
  if (!row || row.document_state !== 'finalized' || !row.csr_number || !row.render_template_snapshot) {
    throw new Error('Only a finalized CSR with a frozen template can be rendered.');
  }
  return renderFinalizedServiceReportPdf(db, reportId, row.csr_number, row.render_template_snapshot);
}

export async function shareServiceReportPdf(db: SQLiteDatabase, reportId: string): Promise<void> {
  const attachment = await db.getFirstAsync<{ private_path: string; deterministic_filename: string }>(
    `SELECT private_path, deterministic_filename
     FROM document_attachments
     WHERE owner_type = 'service_report' AND owner_id = ? AND attachment_type = 'generated_pdf'`,
    reportId,
  );
  if (!attachment) throw new Error('Generate the CSR PDF before sharing.');
  if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable on this device.');

  await Sharing.shareAsync(attachment.private_path, {
    dialogTitle: `Share ${attachment.deterministic_filename}`,
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
  });

  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync("UPDATE service_reports SET share_state = 'shared' WHERE id = ?", reportId);
    await appendAuditEvent(tx, {
      eventType: 'csr.share_sheet_opened',
      entityType: 'service_report',
      entityId: reportId,
      createdAt: new Date().toISOString(),
    });
    await incrementDatabaseRevision(tx);
  });
}

async function renderFinalizedServiceReportPdf(
  db: SQLiteDatabase,
  reportId: string,
  csrNumber: string,
  html: string,
): Promise<string> {
  let cacheUri: string | undefined;
  try {
    const result = await Print.printToFileAsync({
      html,
      width: LEGAL_WIDTH_POINTS,
      height: LEGAL_HEIGHT_POINTS,
      base64: true,
      textZoom: 100,
    });
    cacheUri = result.uri;
    if (!FileSystem.documentDirectory) throw new Error('Persistent document storage is unavailable.');
    if (!result.base64) throw new Error('PDF checksum source was not returned.');

    const directory = `${FileSystem.documentDirectory}documents/`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const filename = `${csrNumber}.pdf`;
    const destination = `${directory}${filename}`;
    const existing = await FileSystem.getInfoAsync(destination);
    if (existing.exists) await FileSystem.deleteAsync(destination, { idempotent: true });
    await FileSystem.copyAsync({ from: result.uri, to: destination });
    const checksum = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, result.base64);
    const now = new Date().toISOString();

    await db.withExclusiveTransactionAsync(async (tx) => {
      const attachment = await tx.getFirstAsync<{ id: string }>(
        `SELECT id FROM document_attachments
         WHERE owner_type = 'service_report' AND owner_id = ? AND attachment_type = 'generated_pdf'`,
        reportId,
      );
      if (attachment) {
        await tx.runAsync(
          `UPDATE document_attachments
           SET deterministic_filename = ?, private_path = ?, checksum = ?, created_at = ?
           WHERE id = ?`,
          filename,
          destination,
          checksum,
          now,
          attachment.id,
        );
      } else {
        await tx.runAsync(
          `INSERT INTO document_attachments
            (id, owner_type, owner_id, attachment_type, deterministic_filename,
             private_path, checksum, created_at)
           VALUES (?, 'service_report', ?, 'generated_pdf', ?, ?, ?, ?)`,
          Crypto.randomUUID(),
          reportId,
          filename,
          destination,
          checksum,
          now,
        );
      }
      await tx.runAsync("UPDATE service_reports SET pdf_state = 'ready' WHERE id = ?", reportId);
      await appendAuditEvent(tx, {
        eventType: 'csr.pdf_rendered',
        entityType: 'service_report',
        entityId: reportId,
        details: { numberOfPages: result.numberOfPages },
        createdAt: now,
      });
      await incrementDatabaseRevision(tx);
    });
    return destination;
  } catch (error) {
    await markPdfError(db, reportId, error);
    throw error;
  } finally {
    if (cacheUri) await FileSystem.deleteAsync(cacheUri, { idempotent: true }).catch(() => undefined);
  }
}

async function markPdfError(db: SQLiteDatabase, reportId: string, error: unknown): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const result = await tx.runAsync(
      "UPDATE service_reports SET pdf_state = 'error' WHERE id = ? AND document_state = 'finalized'",
      reportId,
    );
    if (result.changes === 1) {
      await appendAuditEvent(tx, {
        eventType: 'csr.pdf_error',
        entityType: 'service_report',
        entityId: reportId,
        details: { message: error instanceof Error ? error.message : String(error) },
        createdAt: new Date().toISOString(),
      });
      await incrementDatabaseRevision(tx);
    }
  });
}
