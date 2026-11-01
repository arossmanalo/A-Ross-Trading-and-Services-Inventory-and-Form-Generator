import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { listShareableStatementsForReport, retryBillingStatementPdf, shareBillingStatementPdf } from '@/features/billing-statements/billing-statement-pdf';
import { printHtmlToPdf } from '@/features/documents/pdf-output';
import { resolveShareFileName } from '@/features/documents/share-file-name';
import { sharePdfFile } from '@/features/documents/share-pdf';
import type { ShareStep } from '@/features/documents/share-sequence';
import { getBusinessLogo } from '@/features/settings/settings-repository';
import { getPreparerSignatureHtml } from '@/features/signatures/capture-repository';
import { getSignatureCapturePreview } from '@/features/signatures/capture-repository';
import { buildCsrHtml, type CsrRenderSnapshot } from '@/features/service-reports/csr-template';
import { finalizeServiceReport, getServiceReport } from '@/features/service-reports/service-report-repository';

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

export async function getServiceReportPreview(
  db: SQLiteDatabase,
  reportId: string,
): Promise<{ csrNumber: string; html: string; isDraft: boolean }> {
  const row = await db.getFirstAsync<{
    csr_number: string | null;
    render_template_snapshot: string | null;
    document_state: string;
  }>(
    'SELECT csr_number, render_template_snapshot, document_state FROM service_reports WHERE id = ?',
    reportId,
  );
  if (!row) throw new Error('CSR was not found.');
  if (row.document_state === 'draft') {
    const report = await getServiceReport(db, reportId);
    if (!report) throw new Error('CSR was not found.');
    const identity = await db.getFirstAsync<{
      customer_address: string;
      equipment_model: string;
      serial_number: string;
      nickname_or_location: string;
      business_name: string;
      business_address: string;
      contact_details: string;
    }>(
      `SELECT c.address AS customer_address, e.model AS equipment_model,
              e.serial_number, e.nickname_or_location,
              s.business_name, s.business_address, s.contact_details
       FROM service_reports r
       JOIN customers c ON c.id = r.customer_id
       JOIN customer_equipment e ON e.id = r.equipment_id
       JOIN settings s ON s.id = 'business'
       WHERE r.id = ?`,
      reportId,
    );
    if (!identity) throw new Error('CSR preview details could not be loaded.');

    const snapshot: CsrRenderSnapshot = {
      includeSignatureLines: false,
      csrNumber: 'DRAFT — UNNUMBERED',
      businessDate: report.businessDate,
      fingerprint: 'DRAFT PREVIEW',
      business: {
        name: identity.business_name,
        address: identity.business_address,
        contactDetails: identity.contact_details,
        logoDataUrl: await getBusinessLogo(db),
      },
      customer: { name: report.customerName, address: identity.customer_address },
      equipment: {
        machineType: report.equipmentName,
        model: identity.equipment_model,
        serialNumber: identity.serial_number,
        nicknameOrLocation: identity.nickname_or_location,
      },
      machines: report.machines.map(({ machineType, model, serialNumber, nicknameOrLocation }) => ({ machineType, model, serialNumber, nicknameOrLocation })),
      machineCount: report.machineCount,
      serviceOutcome: report.serviceOutcome,
      reportedProblem: report.reportedProblem,
      diagnosis: report.diagnosis,
      actionTaken: report.actionTaken,
      recommendations: report.recommendations,
      billing: report.billing,
      customerRemarks: report.customerRemarks,
      machineStatus: report.machineStatus,
      warrantyText: report.warrantyText,
      servicedBy: report.servicedBy,
      acknowledgedBy: report.acknowledgedBy,
      totalBillCentavos: report.totalBillCentavos,
      usages: report.usages.map((usage) => ({
        description: usage.itemName,
        quantity: usage.quantity,
        unitLabel: usage.unitLabel,
        billable: usage.billable,
      })),
      services: report.services.map((service) => ({
        description: service.serviceName,
        rateCentavos: service.resolvedRateCentavos,
      })),
    };
    return { csrNumber: snapshot.csrNumber, html: buildCsrHtml(snapshot), isDraft: true };
  }
  if (row.document_state !== 'finalized' || !row.csr_number || !row.render_template_snapshot) {
    throw new Error('Only a draft or finalized CSR can be previewed.');
  }
  const signed = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM signature_captures
     WHERE owner_type='service_report' AND owner_id=?
     ORDER BY created_at DESC,rowid DESC LIMIT 1`, reportId,
  );
  if (signed) {
    const preview = await getSignatureCapturePreview(db, signed.id);
    return { csrNumber: preview.number, html: preview.html, isDraft: false };
  }
  return { csrNumber: row.csr_number, html: row.render_template_snapshot, isDraft: false };
}

/**
 * Everything to hand to the share sheet for a finalized CSR: the CSR itself,
 * then each finalized Billing Statement linked to it. Missing PDFs are rendered
 * first so a failure shows before any sheet opens.
 */
export async function getServiceReportShareSteps(db: SQLiteDatabase, reportId: string): Promise<ShareStep[]> {
  const report = await db.getFirstAsync<{ document_state: string }>('SELECT document_state FROM service_reports WHERE id = ?', reportId);
  if (!report || report.document_state !== 'finalized') throw new Error('Only a finalized CSR can be shared.');

  const stored = await db.getFirstAsync<{ private_path: string }>(
    `SELECT private_path FROM document_attachments
     WHERE owner_type = 'service_report' AND owner_id = ? AND attachment_type = 'generated_pdf'`,
    reportId,
  );
  if (!stored?.private_path || !(await FileSystem.getInfoAsync(stored.private_path)).exists) {
    await retryServiceReportPdf(db, reportId);
  }

  const statements = await listShareableStatementsForReport(db, reportId);
  for (const statement of statements) {
    if (statement.pdfState !== 'ready') await retryBillingStatementPdf(db, statement.id);
  }

  const steps: ShareStep[] = [{
    title: 'Customer Service Report',
    fileName: await resolveShareFileName(db, 'service_report', reportId),
    run: () => shareServiceReportPdf(db, reportId),
  }];
  for (const statement of statements) {
    steps.push({
      title: 'Billing Statement',
      fileName: await resolveShareFileName(db, 'billing_statement', statement.id),
      run: () => shareBillingStatementPdf(db, statement.id),
    });
  }
  return steps;
}

export async function shareServiceReportPdf(db: SQLiteDatabase, reportId: string): Promise<void> {
  const attachment = await db.getFirstAsync<{ private_path: string }>(
    `SELECT private_path
     FROM document_attachments
     WHERE owner_type = 'service_report' AND owner_id = ? AND attachment_type = 'generated_pdf'`,
    reportId,
  );
  if (!attachment) throw new Error('Generate the CSR PDF before sharing.');
  const fileName = await resolveShareFileName(db, 'service_report', reportId);

  await sharePdfFile({ sourceUri: attachment.private_path, fileName });

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
    const result = await printHtmlToPdf(html, 'legal', { base64: true });
    cacheUri = result.uri;
    if (!FileSystem.documentDirectory) throw new Error('Persistent document storage is unavailable.');
    if (!result.base64) throw new Error('PDF checksum source was not returned.');

    const directory = `${FileSystem.documentDirectory}documents/`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const filename = `${csrNumber}.pdf`;
    const destination = `${directory}${filename}`;
    const existing = await FileSystem.getInfoAsync(destination);
    if (existing.exists) await FileSystem.deleteAsync(destination, { idempotent: true });
    await FileSystem.writeAsStringAsync(destination, result.base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
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
