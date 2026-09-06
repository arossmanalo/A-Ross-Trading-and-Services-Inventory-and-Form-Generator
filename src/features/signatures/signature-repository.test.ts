/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5 } from '@/db/schema';

const files = vi.hoisted(() => new Map<string,string>());
const printer = vi.hoisted(() => vi.fn());
vi.mock('expo-crypto',() => ({randomUUID:() => randomUUID(),CryptoDigestAlgorithm:{SHA256:'SHA256'},digestStringAsync:async (_:string,value:string) => createHash('sha256').update(value).digest('hex')}));
vi.mock('expo-document-picker',() => ({getDocumentAsync:vi.fn()}));
vi.mock('expo-sharing',() => ({isAvailableAsync:async()=>true,shareAsync:vi.fn()}));
vi.mock('expo-print',() => ({printToFileAsync:printer}));
vi.mock('expo-file-system/legacy',() => ({
  documentDirectory:'private/',EncodingType:{Base64:'base64'},
  getInfoAsync:async(path:string) => ({exists:files.has(path),isDirectory:false,size:files.get(path)?.length??0}),
  makeDirectoryAsync:async()=>{},
  copyAsync:async({from,to}:{from:string;to:string}) => {if(!files.has(from))throw new Error('Missing source');files.set(to,files.get(from)!);},
  writeAsStringAsync:async(path:string,contents:string) => {files.set(path,contents);},
  readAsStringAsync:async(path:string) => files.get(path),
  deleteAsync:async(path:string) => {files.delete(path);},
}));

import { clearSavedPreparerSignature, getPreparerSignatureHtml, listSignatureCaptures, saveSignatureCapture } from '@/features/signatures/capture-repository';
import { renderSignaturePdf } from '@/features/signatures/capture-pdf';
import { attachSignedPdf, getSignableDocument, shareSignedAttachment } from '@/features/signatures/signature-repository';
import { addServiceLine, createBillingStatementDraft, finalizeBillingStatement } from '@/features/billing-statements/billing-statement-repository';
import { validateSignaturePng } from '@/features/signatures/signature-html';
import { getBusinessLogo, saveBusinessLogo } from '@/features/settings/settings-repository';

// A tiny raster fixture, not a real person's signature.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6bOAAAAAASUVORK5CYII=';
const ORIGINAL = '<html><body><p>Frozen customer charges</p></body></html>';
type Params = Array<string|number|null>;
function adapter(raw:DatabaseSync):SQLiteDatabase {
  const api = {
    getFirstAsync:async<T>(sql:string,...params:Params) => raw.prepare(sql).get(...params) as T|undefined,
    getAllAsync:async<T>(sql:string,...params:Params) => raw.prepare(sql).all(...params) as T[],
    runAsync:async(sql:string,...params:Params) => ({changes:Number(raw.prepare(sql).run(...params).changes)}),
    withExclusiveTransactionAsync:async(task:(tx:SQLiteDatabase)=>Promise<unknown>) => {raw.exec('BEGIN IMMEDIATE');try{await task(api as unknown as SQLiteDatabase);raw.exec('COMMIT');}catch(e){raw.exec('ROLLBACK');throw e;}},
  };
  return api as unknown as SQLiteDatabase;
}

describe('signature persistence and recovery',() => {
  let raw:DatabaseSync; let db:SQLiteDatabase;
  beforeEach(() => {
    files.clear();printer.mockReset();
    printer.mockImplementation(async()=>{files.set('cache/render.pdf','JVBERi0xLjQK');return{uri:'cache/render.pdf',base64:'JVBERi0xLjQK'};});
    raw = new DatabaseSync(':memory:');
    raw.exec(`PRAGMA foreign_keys=ON;${SCHEMA_V1}${SCHEMA_V2}${SCHEMA_V3}${SCHEMA_V4}${SCHEMA_V5}
      INSERT INTO app_meta VALUES('database_revision','0');
      INSERT INTO sequences VALUES('CSR',0),('BS',1),('PA',0);
      INSERT INTO settings(id,business_name,owner_name,created_at,updated_at) VALUES('business','A.Ross','Owner','now','now');
      INSERT INTO customers(id,name,created_at,updated_at) VALUES('customer','Current name','now','now');
      INSERT INTO billing_statements(id,bs_number,customer_id,business_date,document_state,created_at) VALUES('statement','BS-000001','customer','2026-09-05','finalized','now');
      INSERT INTO services(id,name,base_rate_centavos,created_at,updated_at) VALUES('service','Labor',50000,'now','now');`);
    raw.prepare('UPDATE billing_statements SET content_snapshot_json=?,render_template_snapshot=? WHERE id=?').run(JSON.stringify({customer:{name:'Frozen name'},fingerprint:'ABC123'}),ORIGINAL,'statement');
    db=adapter(raw);
  });
  afterEach(()=>raw.close());
  const input = () => ({id:'capture-1',ownerType:'billing_statement' as const,ownerId:'statement',role:'customer' as const,signerName:'Customer <One>',pngDataUrl:PNG});

  it('saves idempotently and never changes original content, numbering, or stock',async()=>{
    await saveSignatureCapture(db,input());await saveSignatureCapture(db,input());
    const captures=await listSignatureCaptures(db,'billing_statement','statement');
    expect(captures).toHaveLength(1);
    expect(captures[0].render_template_snapshot).toContain('Customer &lt;One&gt;');
    expect(captures[0].render_template_snapshot).toContain('ABC123');
    expect(raw.prepare('SELECT render_template_snapshot FROM billing_statements').get()).toEqual({render_template_snapshot:ORIGINAL});
    expect(raw.prepare("SELECT high_water_mark FROM sequences WHERE name='BS'").get()).toEqual({high_water_mark:1});
    expect((await getSignableDocument(db,'billing_statement','statement'))?.signatureStatus).toBe('signed_in_person');
    expect((await getSignableDocument(db,'billing_statement','statement'))?.customerName).toBe('Frozen name');
    await expect(saveSignatureCapture(db,{...input(),signerName:'Another'})).rejects.toThrow(/already been used/);
  });
  it('retains older captures and combines the latest other-role signature in the next version',async()=>{
    await saveSignatureCapture(db,input());
    await saveSignatureCapture(db,{...input(),id:'capture-2',role:'preparer',signerName:'Owner'});
    const versions=await listSignatureCaptures(db,'billing_statement','statement');
    expect(versions).toHaveLength(2);
    expect(versions[0].render_template_snapshot).toContain('Customer &lt;One&gt;');
    expect(versions[0].render_template_snapshot).toContain('Owner');
    expect(()=>raw.prepare('UPDATE signature_captures SET signer_name=?').run('Tampered')).toThrow(/IMMUTABLE/);
    expect(()=>raw.exec('DELETE FROM signature_captures')).toThrow(/IMMUTABLE/);
  });
  it('rejects signing voided documents and invalid image/filename inputs',async()=>{
    raw.exec("UPDATE billing_statements SET document_state='voided'");
    await expect(saveSignatureCapture(db,input())).rejects.toThrow(/finalized/);
    expect(()=>validateSignaturePng('data:image/svg+xml,<svg>')).toThrow(/invalid/);
    await expect(saveSignatureCapture(db,{...input(),id:'../escape'})).rejects.toThrow(/identifier/);
  });
  it('rolls back capture and status if audit/revision persistence fails',async()=>{
    raw.exec("DELETE FROM app_meta WHERE key='database_revision'");
    await expect(saveSignatureCapture(db,input())).rejects.toThrow(/revision/);
    expect(await listSignatureCaptures(db,'billing_statement','statement')).toHaveLength(0);
    expect((await getSignableDocument(db,'billing_statement','statement'))?.signatureStatus).toBe('not_required');
  });
  it('freezes default signature in new statements and payments, then preserves history when cleared',async()=>{
    await saveBusinessLogo(db,PNG);
    await saveSignatureCapture(db,{...input(),id:'default',ownerType:'settings',ownerId:'business',role:'preparer',signerName:'Owner'});
    const today=new Date().toLocaleDateString('en-CA');
    const id=await createBillingStatementDraft(db,{customerId:'customer',businessDate:today});
    await addServiceLine(db,id,{serviceId:'service'});
    const issued=await finalizeBillingStatement(db,id,'reject',{choice:'paid_in_full',payment:{amountCentavos:50000,businessDate:today,method:'cash'}});
    expect(issued.html).toContain(PNG);
    expect(issued.html).toContain('alt="Business logo"');
    expect(issued.snapshot.business.logoDataUrl).toBe(PNG);
    expect(issued.initialPayment?.snapshot.business.logoDataUrl).toBe(PNG);
    expect(issued.initialPayment?.html).toContain(PNG);
    await clearSavedPreparerSignature(db);
    await saveBusinessLogo(db,null);
    expect(await getBusinessLogo(db)).toBeNull();
    expect(await getPreparerSignatureHtml(db)).toBe('');
    expect((await finalizeBillingStatement(db,id)).html).toBe(issued.html);
  });
  it('rejects remote and oversized logo data',async()=>{
    await expect(saveBusinessLogo(db,'https://example.com/logo.png')).rejects.toThrow(/PNG or JPEG/);
    await expect(saveBusinessLogo(db,'data:image/png;base64,'+'a'.repeat(2_800_000))).rejects.toThrow(/PNG or JPEG/);
  });
  it('retains a captured signature after render failure and retries without creating another capture',async()=>{
    await saveSignatureCapture(db,input());
    printer.mockRejectedValueOnce(new Error('Storage full'));
    await expect(renderSignaturePdf(db,'capture-1')).rejects.toThrow('Storage full');
    expect((await listSignatureCaptures(db,'billing_statement','statement'))[0].pdf_state).toBe('error');
    const path=await renderSignaturePdf(db,'capture-1');
    expect(files.has(path)).toBe(true);
    expect(await listSignatureCaptures(db,'billing_statement','statement')).toHaveLength(1);
    await renderSignaturePdf(db,'capture-1');
    expect(printer).toHaveBeenCalledTimes(2);
    files.delete(path);
    await renderSignaturePdf(db,'capture-1');
    expect(printer).toHaveBeenCalledTimes(3);
  });
  it('requires manual matching, checks PDF bytes, and keeps separate returned files',async()=>{
    files.set('source.pdf','JVBERi0xLjQK');
    await expect(attachSignedPdf(db,'billing_statement','statement','source.pdf','wrong')).rejects.toThrow(/Confirm/);
    const first=await attachSignedPdf(db,'billing_statement','statement','source.pdf','ABC123');
    const second=await attachSignedPdf(db,'billing_statement','statement','source.pdf','ABC123');
    expect(first).not.toBe(second);expect(files.has(first)).toBe(true);
    expect((await getSignableDocument(db,'billing_statement','statement'))?.attachments).toHaveLength(2);
    files.set('invalid.pdf','not-pdf');
    await expect(attachSignedPdf(db,'billing_statement','statement','invalid.pdf','ABC123')).rejects.toThrow(/PDF header/);
    expect([...files.keys()].filter(k=>k.startsWith('private/'))).toHaveLength(2);
  });
  it('removes an uncommitted imported copy on transaction failure and explains missing files',async()=>{
    files.set('source.pdf','JVBERi0xLjQK');raw.exec("DELETE FROM app_meta");
    await expect(attachSignedPdf(db,'billing_statement','statement','source.pdf','ABC123')).rejects.toThrow(/revision/);
    expect([...files.keys()]).toEqual(['source.pdf']);
    await expect(shareSignedAttachment({id:'missing',filename:'missing.pdf',privatePath:'missing',checksum:'',createdAt:'now'})).rejects.toThrow(/missing/);
  });
});
