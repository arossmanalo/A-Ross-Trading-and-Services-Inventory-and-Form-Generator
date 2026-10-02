import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { withDocumentHeaderLayout } from '@/features/documents/document-header';
import { listSignatureCaptures, type SignatureCapture } from '@/features/signatures/capture-repository';
import { applySignatureCapturesToDocument, signatureBlock, validateSignaturePng } from '@/features/signatures/signature-html';
import type { SignableOwnerType } from '@/features/signatures/signature-types';

export type SignatureDraft = {
  owner_type: SignableOwnerType;
  owner_id: string;
  role: 'customer' | 'preparer';
  signer_name: string;
  png_data_url: string;
  updated_at: string;
};

type OwnerSnapshot = { number: string | null; render_template_snapshot: string | null };

function ownerSql(ownerType: SignableOwnerType): string {
  if (ownerType === 'service_report') return "SELECT csr_number AS number, render_template_snapshot FROM service_reports WHERE id=? AND document_state='finalized'";
  if (ownerType === 'billing_statement') return "SELECT bs_number AS number, render_template_snapshot FROM billing_statements WHERE id=? AND document_state='finalized'";
  throw new Error('Invalid signing target.');
}

export async function listSignatureDrafts(db: SQLiteDatabase, ownerType: SignableOwnerType, ownerId: string): Promise<SignatureDraft[]> {
  return db.getAllAsync<SignatureDraft>('SELECT * FROM signature_drafts WHERE owner_type=? AND owner_id=? ORDER BY role', ownerType, ownerId);
}

export async function saveSignatureDraft(db: SQLiteDatabase, input: {
  ownerType: SignableOwnerType; ownerId: string; role: SignatureDraft['role']; signerName: string; pngDataUrl: string;
}): Promise<void> {
  validateSignaturePng(input.pngDataUrl);
  if (!['customer', 'preparer'].includes(input.role)) throw new Error('Invalid signature role.');
  const signerName = input.signerName.trim();
  if (!signerName || signerName.length > 200) throw new Error('Enter the signer’s name (up to 200 characters).');
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async tx => {
    const owner = await tx.getFirstAsync<OwnerSnapshot>(ownerSql(input.ownerType), input.ownerId);
    if (!owner?.number || !owner.render_template_snapshot) throw new Error('Only a finalized document can be signed.');
    const previous = await tx.getFirstAsync<{ id: string }>(
      'SELECT id FROM signature_captures WHERE owner_type=? AND owner_id=? AND role=? LIMIT 1',
      input.ownerType, input.ownerId, input.role,
    );
    if (previous) throw new Error(`The ${input.role} signature is already finalized and cannot be redrawn.`);
    await tx.runAsync(
      `INSERT INTO signature_drafts(owner_type,owner_id,role,signer_name,png_data_url,updated_at)
       VALUES(?,?,?,?,?,?) ON CONFLICT(owner_type,owner_id,role) DO UPDATE SET
       signer_name=excluded.signer_name,png_data_url=excluded.png_data_url,updated_at=excluded.updated_at`,
      input.ownerType, input.ownerId, input.role, signerName, input.pngDataUrl, now,
    );
    await appendAuditEvent(tx, { eventType: 'signature.draft_saved', entityType: input.ownerType, entityId: input.ownerId, details: { role: input.role }, createdAt: now });
    await incrementDatabaseRevision(tx);
  });
}

function asBlock(mark: Pick<SignatureDraft, 'role' | 'signer_name' | 'png_data_url'> & { created_at?: string; updated_at?: string }): string {
  return signatureBlock(
    { signerName: mark.signer_name, pngDataUrl: mark.png_data_url, createdAt: mark.updated_at ?? mark.created_at ?? '' },
    mark.role === 'customer' ? 'Acknowledged by customer' : 'Prepared / serviced by',
  );
}

function signedHtml(original: string, captures: SignatureCapture[], drafts: SignatureDraft[]): string {
  const latestByRole = new Map<SignatureCapture['role'], SignatureCapture>();
  for (const capture of captures) if (!latestByRole.has(capture.role)) latestByRole.set(capture.role, capture);
  return applySignatureCapturesToDocument(withDocumentHeaderLayout(original), [
    ...[...latestByRole.values()].map(asBlock),
    ...drafts.map(asBlock),
  ]);
}

export async function getSignatureDraftPreview(db: SQLiteDatabase, ownerType: SignableOwnerType, ownerId: string): Promise<{ number: string; html: string }> {
  const owner = await db.getFirstAsync<OwnerSnapshot>(ownerSql(ownerType), ownerId);
  if (!owner?.number || !owner.render_template_snapshot) throw new Error('Only a finalized document can be signed.');
  const drafts = await listSignatureDrafts(db, ownerType, ownerId);
  if (!drafts.length) throw new Error('Draw a signature before previewing it.');
  const captures = await listSignatureCaptures(db, ownerType, ownerId);
  return { number: owner.number, html: signedHtml(owner.render_template_snapshot, captures, drafts) };
}

/** Adds an interactive canvas directly to the chosen signature block in the document preview. */
export async function getSignatureCanvasDocument(
  db: SQLiteDatabase,
  ownerType: SignableOwnerType,
  ownerId: string,
  role: SignatureDraft['role'],
): Promise<{ number: string; html: string }> {
  const owner = await db.getFirstAsync<OwnerSnapshot>(ownerSql(ownerType), ownerId);
  if (!owner?.number || !owner.render_template_snapshot) throw new Error('Only a finalized document can be signed.');
  const captures = await listSignatureCaptures(db, ownerType, ownerId);
  if (captures.some(capture => capture.role === role)) throw new Error(`The ${role} signature is already finalized.`);
  const drafts = await listSignatureDrafts(db, ownerType, ownerId);
  const html = signedHtml(owner.render_template_snapshot, captures, drafts.filter(draft => draft.role !== role));
  const slot = new RegExp(`<div class="signature-writing" data-signature-image-slot="${role}">[\\s\\S]*?<\\/div>`);
  const replacement = `<div class="signature-writing signature-input" data-signature-image-slot="${role}"><canvas id="signature-canvas" aria-label="Draw ${role} signature"></canvas></div>`;
  if (!slot.test(html)) throw new Error('The document is missing its signature area.');
  const styles = `<style id="signature-canvas-preview-style">.signature-input{height:132px!important;min-height:132px!important;position:relative;background:#fff;border:2px dashed #0755ad;border-radius:6px;touch-action:none;overflow:hidden}.signature-input:after{content:'SIGN HERE';position:absolute;inset:0;display:grid;place-items:center;color:#94a3b8;font:700 13px Arial;letter-spacing:2px;pointer-events:none}.signature-input.has-ink:after{display:none}#signature-canvas{display:block;width:100%;height:100%;touch-action:none}</style>`;
  const script = `<script>
(()=>{const canvas=document.getElementById('signature-canvas');if(!canvas)return;const box=canvas.parentElement,ctx=canvas.getContext('2d');let strokes=[],active=null;
function send(v){window.ReactNativeWebView.postMessage(JSON.stringify(v));}
function setup(){canvas.width=1200;canvas.height=480;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.strokeStyle='#111827';ctx.lineWidth=6;ctx.lineCap='round';ctx.lineJoin='round';for(const stroke of strokes){ctx.beginPath();stroke.forEach((p,i)=>i?ctx.lineTo(p.x*canvas.width,p.y*canvas.height):ctx.moveTo(p.x*canvas.width,p.y*canvas.height));ctx.stroke();if(stroke.length===1){ctx.beginPath();ctx.arc(stroke[0].x*canvas.width,stroke[0].y*canvas.height,3,0,Math.PI*2);ctx.fillStyle='#111827';ctx.fill();}}}
function point(e){const r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};}
canvas.addEventListener('pointerdown',e=>{if(active)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);active={id:e.pointerId,points:[point(e)]};strokes.push(active.points);box.classList.add('has-ink');setup();send({type:'changed',hasInk:true});});
canvas.addEventListener('pointermove',e=>{if(!active||e.pointerId!==active.id)return;e.preventDefault();active.points.push(point(e));setup();});
function end(e){if(active&&active.id===e.pointerId)active=null;}canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
window.clearSignature=()=>{strokes=[];active=null;box.classList.remove('has-ink');setup();send({type:'changed',hasInk:false});};
window.updateSignerName=(value)=>{const slot=document.querySelector('.signature-name[data-signature-name-slot="${role}"]');if(slot)slot.textContent=value;};
window.exportSignature=()=>{if(!strokes.length){send({type:'error',message:'Draw your signature in the document’s signature area first.'});return;}send({type:'signature',data:canvas.toDataURL('image/png')});};setup();send({type:'ready'});
})();
</script>`;
  return {
    number: owner.number,
    html: html.replace(slot, replacement).replace('</head>', `${styles}</head>`).replace('</body>', `${script}</body>`),
  };
}

/** Commits all staged marks together, leaving the frozen original document untouched. */
export async function finalizeSignatureDrafts(db: SQLiteDatabase, ownerType: SignableOwnerType, ownerId: string): Promise<string> {
  let latestId = '';
  await db.withExclusiveTransactionAsync(async tx => {
    const owner = await tx.getFirstAsync<OwnerSnapshot>(ownerSql(ownerType), ownerId);
    if (!owner?.number || !owner.render_template_snapshot) throw new Error('Only a finalized document can be signed.');
    const drafts = await listSignatureDrafts(tx, ownerType, ownerId);
    const captures = await listSignatureCaptures(tx, ownerType, ownerId);
    if (!drafts.length) {
      // A retry after a committed finalization returns the same signed version.
      if (captures[0]) { latestId = captures[0].id; return; }
      throw new Error('Draw a signature before finalizing it.');
    }
    if (drafts.some(draft => captures.some(capture => capture.role === draft.role))) throw new Error('A signature for this role was already finalized.');
    const html = signedHtml(owner.render_template_snapshot, captures, drafts);
    const now = new Date().toISOString();
    for (const draft of drafts) {
      latestId = Crypto.randomUUID();
      await tx.runAsync(
        `INSERT INTO signature_captures(id,owner_type,owner_id,role,signer_name,png_data_url,created_at,render_template_snapshot,deterministic_filename)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        latestId, ownerType, ownerId, draft.role, draft.signer_name, draft.png_data_url, now, html, `${owner.number}-in-person-${latestId}.pdf`,
      );
    }
    await tx.runAsync('DELETE FROM signature_drafts WHERE owner_type=? AND owner_id=?', ownerType, ownerId);
    const table = ownerType === 'service_report' ? 'service_reports' : 'billing_statements';
    await tx.runAsync(`UPDATE ${table} SET signature_status=CASE WHEN signature_status='signed_document_attached' THEN signature_status ELSE 'signed_in_person' END WHERE id=?`, ownerId);
    await appendAuditEvent(tx, { eventType: 'signature.finalized', entityType: ownerType, entityId: ownerId, details: { roles: drafts.map(draft => draft.role).join(','), captureId: latestId }, createdAt: now });
    await incrementDatabaseRevision(tx);
  });
  return latestId;
}
