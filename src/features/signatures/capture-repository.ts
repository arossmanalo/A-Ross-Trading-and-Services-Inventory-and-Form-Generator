import type { SQLiteDatabase } from 'expo-sqlite';
import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { appendSigningPage, signatureBlock, validateSignaturePng } from '@/features/signatures/signature-html';
import type { SignableOwnerType } from '@/features/signatures/signature-types';

export type SignatureCapture = {
  id: string; role: 'customer' | 'preparer'; signer_name: string; png_data_url: string;
  created_at: string; render_template_snapshot: string | null; pdf_state: 'pending' | 'ready' | 'error';
  deterministic_filename: string | null; private_path: string | null; checksum: string | null;
  owner_type: 'settings' | SignableOwnerType; owner_id: string;
};

export async function getSavedPreparerSignature(db: SQLiteDatabase): Promise<SignatureCapture | null> {
  return db.getFirstAsync<SignatureCapture>(`SELECT c.* FROM signature_captures c JOIN settings s ON s.owner_signature_asset_id=c.id WHERE s.id='business' AND c.owner_type='settings'`);
}

export async function getPreparerSignatureHtml(db: SQLiteDatabase): Promise<string> {
  const saved = await getSavedPreparerSignature(db);
  return saved ? block(saved) : '';
}

export async function clearSavedPreparerSignature(db: SQLiteDatabase): Promise<void> {
  await db.withExclusiveTransactionAsync(async tx => {
    await tx.runAsync("UPDATE settings SET owner_signature_asset_id=NULL,updated_at=? WHERE id='business'", new Date().toISOString());
    await appendAuditEvent(tx, {eventType:'signature.default_cleared',entityType:'settings',entityId:'business'});
    await incrementDatabaseRevision(tx);
  });
}

export async function listSignatureCaptures(db: SQLiteDatabase, ownerType: SignableOwnerType, ownerId: string): Promise<SignatureCapture[]> {
  return db.getAllAsync<SignatureCapture>('SELECT * FROM signature_captures WHERE owner_type=? AND owner_id=? ORDER BY created_at DESC,rowid DESC', ownerType, ownerId);
}

export async function saveSignatureCapture(db: SQLiteDatabase, input: {
  id: string; ownerType: 'settings' | SignableOwnerType; ownerId: string;
  role: 'customer' | 'preparer'; signerName: string; pngDataUrl: string;
}): Promise<string> {
  validateSignaturePng(input.pngDataUrl);
  if (!['settings','service_report','billing_statement'].includes(input.ownerType) || !['customer','preparer'].includes(input.role)) throw new Error('Invalid signing target.');
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(input.id)) throw new Error('Invalid signature request identifier.');
  const signerName = input.signerName.trim();
  if (!signerName || signerName.length > 200) throw new Error('Enter the signer’s name (up to 200 characters).');
  if (!input.id || !input.ownerId) throw new Error('Signature identity is missing.');
  if (input.ownerType === 'settings' && (input.ownerId !== 'business' || input.role !== 'preparer')) throw new Error('Only preparer signatures can be saved in Settings.');
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async tx => {
    const existing = await tx.getFirstAsync<SignatureCapture>('SELECT * FROM signature_captures WHERE id=?',input.id);
    if (existing) {
      if (existing.owner_type !== input.ownerType || existing.owner_id !== input.ownerId || existing.role !== input.role || existing.png_data_url !== input.pngDataUrl || existing.signer_name !== signerName) throw new Error('This signing request has already been used.');
      return;
    }
    let html: string | null = null;
    let filename: string | null = null;
    if (input.ownerType !== 'settings') {
      const table = input.ownerType === 'service_report' ? 'service_reports' : 'billing_statements';
      const numberColumn = input.ownerType === 'service_report' ? 'csr_number' : 'bs_number';
      const owner = await tx.getFirstAsync<{number:string;render_template_snapshot:string;content_snapshot_json:string}>(`SELECT ${numberColumn} AS number,render_template_snapshot,content_snapshot_json FROM ${table} WHERE id=? AND document_state='finalized'`,input.ownerId);
      if (!owner?.render_template_snapshot) throw new Error('Only a finalized document can be signed.');
      const snapshot = JSON.parse(owner.content_snapshot_json) as { fingerprint: string };
      const prior = await listSignatureCaptures(tx,input.ownerType,input.ownerId);
      const other = prior.find(c => c.role !== input.role);
      const newBlock = signatureBlock({signerName,pngDataUrl:input.pngDataUrl,createdAt:now},input.role === 'customer' ? 'Acknowledged by customer' : 'Prepared / serviced by');
      html = appendSigningPage(owner.render_template_snapshot,[...(other ? [block(other)] : []),newBlock],owner.number,snapshot.fingerprint,input.id);
      filename = `${owner.number}-in-person-${input.id}.pdf`;
      if (input.role === 'customer') await tx.runAsync(`UPDATE ${table} SET signature_status='signed_in_person' WHERE id=?`,input.ownerId);
    }
    await tx.runAsync(`INSERT INTO signature_captures(id,owner_type,owner_id,role,signer_name,png_data_url,created_at,render_template_snapshot,deterministic_filename) VALUES(?,?,?,?,?,?,?,?,?)`,input.id,input.ownerType,input.ownerId,input.role,signerName,input.pngDataUrl,now,html,filename);
    if (input.ownerType === 'settings') await tx.runAsync("UPDATE settings SET owner_signature_asset_id=?,updated_at=? WHERE id='business'",input.id,now);
    await appendAuditEvent(tx,{eventType:'signature.captured',entityType:input.ownerType,entityId:input.ownerId,details:{captureId:input.id,role:input.role,signerName},createdAt:now});
    await incrementDatabaseRevision(tx);
  });
  return input.id;
}

function block(c: SignatureCapture): string {
  return signatureBlock({signerName:c.signer_name,pngDataUrl:c.png_data_url,createdAt:c.created_at},c.role === 'customer' ? 'Acknowledged by customer' : 'Prepared / serviced by');
}
