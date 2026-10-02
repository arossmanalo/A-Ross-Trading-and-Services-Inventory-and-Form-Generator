import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text } from 'react-native';
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
  const requestId = useRef(Crypto.randomUUID());
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    if (ownerType === 'settings') {setTarget('Default preparer signature');return;}
    if (!['service_report','billing_statement'].includes(ownerType)) return;
    void getSignableDocument(db,ownerType as SignableOwnerType,ownerId).then(async document => {
      if (!document || document.documentState !== 'finalized') throw new Error('Only finalized documents can be signed.');
      const [canvasDocument,drafts] = await Promise.all([
        getSignatureCanvasDocument(db,ownerType as SignableOwnerType,ownerId,role as 'customer'|'preparer'),
        listSignatureDrafts(db,ownerType as SignableOwnerType,ownerId),
      ]);
      if (!active) return [];
      setTarget(`${document.documentNumber} · ${document.customerName}\nRevision 1 · ${document.fingerprint}`);
      setDocumentHtml(canvasDocument.html);
      return drafts;
    }).then(drafts => {
      if (!active) return;
      const existing = drafts.find(draft => draft.role === role);
      if (existing) setName(existing.signer_name);
    }).catch((e:unknown) => {if (active) setError(e instanceof Error ? e.message : 'Could not load signing target.');});
    return () => {active = false;};
  },[db,ownerType,ownerId,role]);
  if (!['settings','service_report','billing_statement'].includes(ownerType) || !['customer','preparer'].includes(role) || !ownerId) return <Text>Invalid signing target.</Text>;
  // The document owns scrolling. Nesting it in a native ScrollView and toggling
  // that parent's responder during a stroke can leave Android presses cancelled.
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex:1,padding:18,gap:12,paddingBottom:18}}>
    <Text numberOfLines={2} style={{fontWeight:'700'}}>{target ?? 'Loading document…'}</Text>
    <Text>{ownerType === 'settings' ? 'Default preparer signature for future documents only.' : `Sign in the ${role} box, then save and review before finalizing.`}</Text>
    <FormField label="Signer’s full name" value={name} onChangeText={setName} editable={!busy} maxLength={200} />
    {ownerType === 'settings' ? <SignaturePad disabled={busy || !target} saveLabel="Save default signature" onCapture={data => {
      if (saving.current) return;
      saving.current=true;setBusy(true);setError(null);
      void saveSignatureCapture(db,{id:requestId.current,ownerType:'settings',ownerId,role:role as 'customer'|'preparer',signerName:name,pngDataUrl:data})
        .then(() => router.back())
        .catch((e:unknown) => setError(e instanceof Error ? e.message : 'Could not save signature.'))
        .finally(() => {saving.current=false;setBusy(false);});
    }} /> : documentHtml ? <DocumentSignatureCanvas html={documentHtml} signerName={name} disabled={busy || !target} onCapture={data => {
      if (saving.current) return;
      saving.current=true;setBusy(true);setError(null);
      void saveSignatureDraft(db,{ownerType:ownerType as SignableOwnerType,ownerId,role:role as 'customer'|'preparer',signerName:name,pngDataUrl:data})
        .then(() => router.back())
        .catch((e:unknown) => setError(e instanceof Error ? e.message : 'Could not save signature.'))
        .finally(() => {saving.current=false;setBusy(false);});
    }} /> : <Text selectable>{target ? 'Loading the finalized document…' : 'Loading document…'}</Text>}
    {error ? <Text selectable style={{color:'#b91c1c'}}>{error}</Text> : null}
  </KeyboardAvoidingView>;
}
