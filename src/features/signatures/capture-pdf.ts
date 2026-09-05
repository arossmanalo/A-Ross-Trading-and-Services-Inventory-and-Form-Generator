import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import type { SQLiteDatabase } from 'expo-sqlite';
import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import type { SignatureCapture } from '@/features/signatures/capture-repository';

const pendingRenders = new Map<string, Promise<string>>();
export function renderSignaturePdf(db: SQLiteDatabase, captureId: string): Promise<string> {
  const pending = pendingRenders.get(captureId);
  if (pending) return pending;
  const task = render(db,captureId).finally(() => pendingRenders.delete(captureId));
  pendingRenders.set(captureId,task);
  return task;
}

async function render(db: SQLiteDatabase, captureId: string): Promise<string> {
  const capture = await db.getFirstAsync<SignatureCapture>('SELECT * FROM signature_captures WHERE id=?',captureId);
  if (!capture?.render_template_snapshot || !capture.deterministic_filename || capture.owner_type === 'settings') throw new Error('No signed document is available for this capture.');
  if (capture.pdf_state === 'ready' && capture.private_path && (await FileSystem.getInfoAsync(capture.private_path)).exists) return capture.private_path;
  if (!FileSystem.documentDirectory) throw new Error('Persistent document storage is unavailable.');
  let cacheUri: string | undefined;
  const directory = `${FileSystem.documentDirectory}documents/in-person/`;
  const destination = `${directory}${capture.deterministic_filename}`;
  try {
    const pdf = await Print.printToFileAsync({html:capture.render_template_snapshot,width:capture.owner_type === 'service_report' ? 612 : 595,height:capture.owner_type === 'service_report' ? 1008 : 842,base64:true,textZoom:100});
    cacheUri = pdf.uri;
    await FileSystem.makeDirectoryAsync(directory,{intermediates:true});
    await FileSystem.copyAsync({from:pdf.uri,to:destination});
    const base64 = await FileSystem.readAsStringAsync(destination,{encoding:FileSystem.EncodingType.Base64});
    if (!base64.startsWith('JVBERi0')) throw new Error('The generated file is not a PDF.');
    const checksum = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,base64);
    await db.withExclusiveTransactionAsync(async tx => {
      await tx.runAsync("UPDATE signature_captures SET pdf_state='ready',private_path=?,checksum=? WHERE id=?",destination,checksum,captureId);
      await appendAuditEvent(tx,{eventType:'signature.pdf_rendered',entityType:capture.owner_type,entityId:capture.owner_id,details:{captureId,checksum}});
      await incrementDatabaseRevision(tx);
    });
    return destination;
  } catch (error) {
    await db.withExclusiveTransactionAsync(async tx => {
      await tx.runAsync("UPDATE signature_captures SET pdf_state='error' WHERE id=?",captureId);
      await incrementDatabaseRevision(tx);
    });
    throw error;
  } finally {
    if (cacheUri) await FileSystem.deleteAsync(cacheUri,{idempotent:true}).catch(() => undefined);
  }
}
