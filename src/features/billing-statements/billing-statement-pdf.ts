import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { finalizeBillingStatement } from '@/features/billing-statements/billing-statement-repository';
import { renderPaymentAcknowledgment } from '@/features/payments/payment-pdf';
import type { InitialPaymentSelection } from '@/features/payments/payment-types';

const A4_WIDTH_POINTS = 595;
const A4_HEIGHT_POINTS = 842;

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

export async function shareBillingStatementPdf(db: SQLiteDatabase, statementId: string): Promise<void> {
  const attachment=await db.getFirstAsync<{private_path:string;deterministic_filename:string}>(`SELECT private_path,deterministic_filename FROM document_attachments WHERE owner_type='billing_statement' AND owner_id=? AND attachment_type='generated_pdf'`,statementId);
  if(!attachment) throw new Error('Generate the billing statement PDF before sharing.');
  if(!(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable on this device.');
  await Sharing.shareAsync(attachment.private_path,{dialogTitle:`Share ${attachment.deterministic_filename}`,mimeType:'application/pdf',UTI:'com.adobe.pdf'});
  await db.withExclusiveTransactionAsync(async(tx)=>{await tx.runAsync("UPDATE billing_statements SET share_state='shared' WHERE id=?",statementId);await appendAuditEvent(tx,{eventType:'billing_statement.share_sheet_opened',entityType:'billing_statement',entityId:statementId,createdAt:new Date().toISOString()});await incrementDatabaseRevision(tx);});
}

async function renderFinalizedBillingStatementPdf(db: SQLiteDatabase, statementId: string, bsNumber: string, html: string): Promise<string> {
  let cacheUri: string | undefined;
  try {
    const result=await Print.printToFileAsync({html,width:A4_WIDTH_POINTS,height:A4_HEIGHT_POINTS,base64:true,textZoom:100}); cacheUri=result.uri;
    if(!FileSystem.documentDirectory) throw new Error('Persistent document storage is unavailable.');
    if(!result.base64) throw new Error('PDF checksum source was not returned.');
    const directory=`${FileSystem.documentDirectory}documents/`; await FileSystem.makeDirectoryAsync(directory,{intermediates:true}); const filename=`${bsNumber}.pdf`; const destination=`${directory}${filename}`; const existing=await FileSystem.getInfoAsync(destination); if(existing.exists) await FileSystem.deleteAsync(destination,{idempotent:true}); await FileSystem.copyAsync({from:result.uri,to:destination});
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
