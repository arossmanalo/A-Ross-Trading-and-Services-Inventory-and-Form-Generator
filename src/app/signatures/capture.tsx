import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { FormField } from '@/components/form-field';
import { saveSignatureCapture } from '@/features/signatures/capture-repository';
import { SignaturePad } from '@/features/signatures/signature-pad';
import { getSignableDocument } from '@/features/signatures/signature-repository';
import type { SignableOwnerType } from '@/features/signatures/signature-types';

export default function CaptureScreen() {
  const {ownerType,ownerId,role} = useLocalSearchParams<{ownerType:string;ownerId:string;role:string}>();
  const db = useSQLiteContext();
  const [name,setName] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const [target,setTarget] = useState<string | null>(null);
  const requestId = useRef(Crypto.randomUUID());
  const saving = useRef(false);
  useEffect(() => {
    if (ownerType === 'settings') {setTarget('Default preparer signature');return;}
    if (!['service_report','billing_statement'].includes(ownerType)) return;
    void getSignableDocument(db,ownerType as SignableOwnerType,ownerId).then(document => {
      if (!document || document.documentState !== 'finalized') throw new Error('Only finalized documents can be signed.');
      setTarget(`${document.documentNumber} · ${document.customerName}\nRevision 1 · ${document.fingerprint}`);
    }).catch((e:unknown) => setError(e instanceof Error ? e.message : 'Could not load signing target.'));
  },[db,ownerType,ownerId]);
  if (!['settings','service_report','billing_statement'].includes(ownerType) || !['customer','preparer'].includes(role) || !ownerId) return <Text>Invalid signing target.</Text>;
  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:18,gap:18,paddingBottom:44}}>
    <Text selectable style={{fontWeight:'700'}}>{target ?? 'Loading document…'}</Text>
    <Text selectable>{ownerType === 'settings' ? 'Saved preparer signature: automatically included in future issued documents. Existing documents are unchanged.' : `Capture the ${role} signature after they review the finalized document. A separate signed version preserves the original PDF.`}</Text>
    <FormField label="Signer’s full name" value={name} onChangeText={setName} editable={!busy} maxLength={200} />
    <SignaturePad disabled={busy || !target} onCapture={data => {
      if (saving.current) return;
      saving.current=true;setBusy(true);setError(null);
      void saveSignatureCapture(db,{id:requestId.current,ownerType:ownerType as 'settings'|'service_report'|'billing_statement',ownerId,role:role as 'customer'|'preparer',signerName:name,pngDataUrl:data})
        .then(() => router.back())
        .catch((e:unknown) => setError(e instanceof Error ? e.message : 'Could not save signature.'))
        .finally(() => {saving.current=false;setBusy(false);});
    }} />
    {error ? <Text selectable style={{color:'#b91c1c'}}>{error}</Text> : null}
  </ScrollView>;
}
