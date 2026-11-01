import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { finalizeBillingStatement, getBillingStatement } from '@/features/billing-statements/billing-statement-repository';
import { getBusinessLogo } from '@/features/settings/settings-repository';
import { getPreparerSignatureHtml, getSignatureCapturePreview } from '@/features/signatures/capture-repository';
import { buildBillingStatementHtml, type BillingStatementRenderSnapshot } from '@/features/billing-statements/billing-statement-template';
import type { BillingStatementSummary } from '@/features/billing-statements/billing-statement-types';
import { printHtmlToPdf } from '@/features/documents/pdf-output';
import { renderPaymentAcknowledgment } from '@/features/payments/payment-pdf';
import type { InitialPaymentSelection } from '@/features/payments/payment-types';

export async function finalizeAndRenderBillingStatement(db: SQLiteDatabase, statementId: string, pricePolicy: 'keep-draft' | 'reject' | 'use-current' = 'reject', paymentSelection: InitialPaymentSelection = { choice: 'pay_later' }): Promise<{ bsNumber: string; pdfUri: string; paymentId: string | null }> {
  const finalized = await finalizeBillingStatement(db, statementId, pricePolicy, paymentSelection);
  const pdfUri = await renderFinalizedBillingStatementPdf(db, statementId, finalized.bsNumber, finalized.html);
  if (finalized.initialPayment) await renderPaymentAcknowledgment(db, finalized.initialPayment);
  return { bsNumber: finalized.bsNumber, pdfUri, paymentId: finalized.initialPayment?.paymentId ?? null };
}

export async function retryBillingStatementPdf(db: SQLiteDatabase, statementId: string): Promise<string> {
  const row = await db.getFirstAsync<{ bs_number: string | null; render_template_snapshot: string | null; document_state: string }>('SELECT bs_number,render_template_snapshot,document_state FROM billing_statements WHERE id=?',statementId);
  if (!row || row.document_state !== 'finalized' || !row.bs_number || !row.render_template_snapshot) throw new Error('Only a finalized statement with a frozen template can be rendered.');
  return renderFinalizedBillingStatementPdf(db,statementId,row.bs_number,row.render_template_snapshot);
}

export async function getBillingStatementPreview(
  db: SQLiteDatabase,
  statementId: string,
): Promise<{ bsNumber: string; html: string; isDraft: boolean }> {
  const row = await db.getFirstAsync<{
    bs_number: string | null;
    render_template_snapshot: string | null;
    document_state: string;
  }>('SELECT bs_number,render_template_snapshot,document_state FROM billing_statements WHERE id=?', statementId);
  if (!row) throw new Error('Billing statement was not found.');
  if (row.document_state === 'draft') {
    const statement = await getBillingStatement(db, statementId);
    if (!statement) throw new Error('Billing statement was not found.');
    const business = await db.getFirstAsync<{
      business_name: string;
      business_address: string;
      contact_details: string;
      vat_display_mode: BillingStatementRenderSnapshot['vatDisplayMode'];
      vat_rate_basis_points: number;
    }>(
      `SELECT business_name, business_address, contact_details,
              vat_display_mode, vat_rate_basis_points
       FROM settings WHERE id = 'business'`,
    );
    if (!business) throw new Error('Business settings could not be loaded.');
    const unitRows = await db.getAllAsync<{ id: string; unit_label: string | null }>(
      `SELECT l.id, i.unit_label
       FROM billing_statement_lines l
       LEFT JOIN items i ON i.id = l.item_id
       WHERE l.billing_statement_id = ?`,
      statementId,
    );
    const unitLabels = new Map(unitRows.map((line) => [line.id, line.unit_label]));
    const discountCentavos = statement.subtotalCentavos - statement.discountedTotalCentavos;
    const discountLabel = statement.discountType === 'fixed'
      ? 'Discount'
      : statement.discountType === 'percentage'
        ? `Discount (${(statement.discountValue / 100).toFixed(2).replace(/\.00$/, '')}%)`
        : null;
    const snapshot: BillingStatementRenderSnapshot = {
      preparerSignatureHtml: await getPreparerSignatureHtml(db),
      bsNumber: 'DRAFT — UNNUMBERED',
      businessDate: statement.businessDate,
      fingerprint: 'DRAFT PREVIEW',
      business: {
        logoDataUrl: await getBusinessLogo(db),
        name: business.business_name,
        address: business.business_address,
        contactDetails: business.contact_details,
      },
      customer: { name: statement.customerName, address: statement.customerAddress },
      serviceReportNumber: statement.serviceReportNumber,
      lines: statement.lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitLabel: line.lineType === 'item' ? unitLabels.get(line.id) ?? 'item' : line.lineType === 'service' && line.quantity > 1 ? 'machines' : line.lineType,
        unitPriceCentavos: line.unitPriceCentavos,
        amountCentavos: line.amountCentavos,
      })),
      subtotalCentavos: statement.subtotalCentavos,
      discountLabel,
      discountCentavos,
      totalCentavos: statement.discountedTotalCentavos,
      paymentsReceivedCentavos: 0,
      balanceDueCentavos: statement.discountedTotalCentavos,
      vatDisplayMode: business.vat_display_mode,
      vatRateBasisPoints: business.vat_rate_basis_points,
    };
    return { bsNumber: snapshot.bsNumber, html: buildBillingStatementHtml(snapshot), isDraft: true };
  }
  if (row.document_state !== 'finalized' || !row.bs_number || !row.render_template_snapshot) {
    throw new Error('Only a draft or finalized statement can be previewed.');
  }
  const signed = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM signature_captures WHERE owner_type='billing_statement' AND owner_id=?
     ORDER BY created_at DESC,rowid DESC LIMIT 1`,
    statementId,
  );
  const html = signed ? (await getSignatureCapturePreview(db, signed.id)).html : row.render_template_snapshot;
  return { bsNumber: row.bs_number, html, isDraft: false };
}

/** Finalized (not draft, not voided) statements billed against a CSR, oldest first. */
export async function listShareableStatementsForReport(db: SQLiteDatabase, reportId: string): Promise<Array<{ id: string; bsNumber: string; pdfState: BillingStatementSummary['pdfState'] }>> {
  const rows = await db.getAllAsync<{ id: string; bs_number: string; pdf_state: BillingStatementSummary['pdfState'] }>(
    `SELECT id, bs_number, pdf_state FROM billing_statements
     WHERE service_report_id = ? AND document_state = 'finalized' AND bs_number IS NOT NULL
     ORDER BY finalized_at, rowid`,
    reportId,
  );
  return rows.map((row) => ({ id: row.id, bsNumber: row.bs_number, pdfState: row.pdf_state }));
}

async function renderFinalizedBillingStatementPdf(db: SQLiteDatabase, statementId: string, bsNumber: string, html: string): Promise<string> {
  let cacheUri: string | undefined;
  try {
    const result=await printHtmlToPdf(html,'a4',{base64:true}); cacheUri=result.uri;
    if(!FileSystem.documentDirectory) throw new Error('Persistent document storage is unavailable.');
    if(!result.base64) throw new Error('PDF checksum source was not returned.');
    const directory=`${FileSystem.documentDirectory}documents/`; await FileSystem.makeDirectoryAsync(directory,{intermediates:true}); const filename=`${bsNumber}.pdf`; const destination=`${directory}${filename}`; const existing=await FileSystem.getInfoAsync(destination); if(existing.exists) await FileSystem.deleteAsync(destination,{idempotent:true}); await FileSystem.writeAsStringAsync(destination,result.base64,{encoding:FileSystem.EncodingType.Base64});
    const checksum=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,result.base64); const now=new Date().toISOString();
    await db.withExclusiveTransactionAsync(async(tx)=>{const attachment=await tx.getFirstAsync<{id:string}>(`SELECT id FROM document_attachments WHERE owner_type='billing_statement' AND owner_id=? AND attachment_type='generated_pdf'`,statementId); if(attachment){await tx.runAsync('UPDATE document_attachments SET deterministic_filename=?,private_path=?,checksum=?,created_at=? WHERE id=?',filename,destination,checksum,now,attachment.id);}else{await tx.runAsync(`INSERT INTO document_attachments(id,owner_type,owner_id,attachment_type,deterministic_filename,private_path,checksum,created_at) VALUES(?,'billing_statement',?,'generated_pdf',?,?,?,?)`,Crypto.randomUUID(),statementId,filename,destination,checksum,now);} await tx.runAsync("UPDATE billing_statements SET pdf_state='ready' WHERE id=?",statementId);await appendAuditEvent(tx,{eventType:'billing_statement.pdf_rendered',entityType:'billing_statement',entityId:statementId,details:{numberOfPages:result.numberOfPages},createdAt:now});await incrementDatabaseRevision(tx);});
    return destination;
  } catch(error) {
    await db.withExclusiveTransactionAsync(async(tx)=>{const changed=await tx.runAsync("UPDATE billing_statements SET pdf_state='error' WHERE id=? AND document_state='finalized'",statementId);if(changed.changes===1){await appendAuditEvent(tx,{eventType:'billing_statement.pdf_error',entityType:'billing_statement',entityId:statementId,details:{message:error instanceof Error?error.message:String(error)},createdAt:new Date().toISOString()});await incrementDatabaseRevision(tx);}});
    throw error;
  } finally {
    if(cacheUri) await FileSystem.deleteAsync(cacheUri,{idempotent:true}).catch(()=>undefined);
  }
}
