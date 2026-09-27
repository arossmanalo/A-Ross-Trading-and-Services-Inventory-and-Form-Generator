import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { FormField } from '@/components/form-field';
import { saveSignatureCapture } from '@/features/signatures/capture-repository';
import { DocumentSignatureCanvas } from '@/features/signatures/document-signature-canvas';
import { getSignatureCanvasDocument, listSignatureDrafts, saveSignatureDraft } from '@/features/signatures/signature-draft-repository';
import { getSignableDocument } from '@/features/signatures/signature-repository';
import { SignaturePad } from '@/features/signatures/signature-pad';
import type { SignableOwnerType } from '@/features/signatures/signature-types';

export default function CaptureScreen() {
  const {ownerType,ownerId,role} = useLocalSearchParams<{ownerType:string;ownerId:string;role:string}>();
  const db = useSQLiteContext();
  const [name,setName] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const [target,setTarget] = useState<string | null>(null);
  const [documentHtml,setDocumentHtml] = useState<string | null>(null);
  const [scrollEnabled,setScrollEnabled] = useState(true);
  const requestId = useRef(Crypto.randomUUID());
  const saving = useRef(false);
  useEffect(() => {
    if (ownerType === 'settings') {setTarget('Default preparer signature');return;}
    if (!['service_report','billing_statement'].includes(ownerType)) return;
    void getSignableDocument(db,ownerType as SignableOwnerType,ownerId).then(async document => {
      if (!document || document.documentState !== 'finalized') throw new Error('Only finalized documents can be signed.');
      const [canvasDocument,drafts] = await Promise.all([
        getSignatureCanvasDocument(db,ownerType as SignableOwnerType,ownerId,role as 'customer'|'preparer'),
        listSignatureDrafts(db,ownerType as SignableOwnerType,ownerId),
      ]);
      setTarget(`${document.documentNumber} · ${document.customerName}\nRevision 1 · ${document.fingerprint}`);
      setDocumentHtml(canvasDocument.html);
      return drafts;
    }).then(drafts => {
      const existing = drafts.find(draft => draft.role === role);
      if (existing) setName(existing.signer_name);
    }).catch((e:unknown) => setError(e instanceof Error ? e.message : 'Could not load signing target.'));
  },[db,ownerType,ownerId,role]);
  if (!['settings','service_report','billing_statement'].includes(ownerType) || !['customer','preparer'].includes(role) || !ownerId) return <Text>Invalid signing target.</Text>;
  return <ScrollView scrollEnabled={scrollEnabled} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:18,gap:18,paddingBottom:44}}>
    <Text selectable style={{fontWeight:'700'}}>{target ?? 'Loading document…'}</Text>
    <Text selectable>{ownerType === 'settings' ? 'Saved preparer signature: automatically included in future issued documents. Existing documents are unchanged.' : `Sign directly in the ${role} signature area on the document below. You can redraw and review it before finalizing. The original PDF remains unchanged.`}</Text>
    <FormField label="Signer’s full name" value={name} onChangeText={setName} editable={!busy} maxLength={200} />
    {ownerType === 'settings' ? <SignaturePad disabled={busy || !target} saveLabel="Save default signature" onInteractionStart={() => setScrollEnabled(false)} onInteractionEnd={() => setScrollEnabled(true)} onCapture={data => {
      if (saving.current) return;
      saving.current=true;setBusy(true);setError(null);
      void saveSignatureCapture(db,{id:requestId.current,ownerType:'settings',ownerId,role:role as 'customer'|'preparer',signerName:name,pngDataUrl:data})
        .then(() => router.back())
        .catch((e:unknown) => setError(e instanceof Error ? e.message : 'Could not save signature.'))
        .finally(() => {saving.current=false;setBusy(false);});
    }} /> : documentHtml ? <DocumentSignatureCanvas html={documentHtml} signerName={name} disabled={busy || !target} onInteractionStart={() => setScrollEnabled(false)} onInteractionEnd={() => setScrollEnabled(true)} onCapture={data => {
      if (saving.current) return;
      saving.current=true;setBusy(true);setError(null);
      void saveSignatureDraft(db,{ownerType:ownerType as SignableOwnerType,ownerId,role:role as 'customer'|'preparer',signerName:name,pngDataUrl:data})
        .then(() => router.back())
        .catch((e:unknown) => setError(e instanceof Error ? e.message : 'Could not save signature.'))
        .finally(() => {saving.current=false;setBusy(false);});
    }} /> : <Text selectable>{target ? 'Loading the finalized document…' : 'Loading document…'}</Text>}
    {error ? <Text selectable style={{color:'#b91c1c'}}>{error}</Text> : null}
  </ScrollView>;
}
