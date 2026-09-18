import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { ActionButton } from '@/components/action-button';
import { listSignatureCaptures, type SignatureCapture } from '@/features/signatures/capture-repository';
import { renderSignaturePdf } from '@/features/signatures/capture-pdf';
import { getSignableDocument, pickAndAttachSignedPdf, setDocumentSignatureStatus, shareSignedAttachment } from '@/features/signatures/signature-repository';
import type { SignableDocument, SignableOwnerType, SignatureStatus } from '@/features/signatures/signature-types';
import { colors } from '@/theme/colors';

const STATUSES: Array<{value:Exclude<SignatureStatus,'signed_in_person'|'signed_document_attached'>;label:string}> = [{value:'not_required',label:'Not required'},{value:'pending',label:'Pending'},{value:'declined',label:'Declined'},{value:'no_response',label:'No response'}];

export default function ManageSignaturesScreen() {
  const {ownerType,ownerId,mode} = useLocalSearchParams<{ownerType:SignableOwnerType;ownerId:string;mode?:'sign'|'import'}>();
  const importing = mode === 'import';
  const db = useSQLiteContext();
  const [document,setDocument] = useState<SignableDocument|null>(null);
  const [captures,setCaptures] = useState<SignatureCapture[]>([]);
  const [matched,setMatched] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const running = useRef(false);
  const load = useCallback(async () => {
    if (!ownerId || !['service_report','billing_statement'].includes(ownerType)) throw new Error('Invalid signing target.');
    setDocument(await getSignableDocument(db,ownerType,ownerId));
    setCaptures(await listSignatureCaptures(db,ownerType,ownerId));
  },[db,ownerType,ownerId]);
  useFocusEffect(useCallback(() => {setMatched(false);void load().catch((e:unknown) => setError(e instanceof Error ? e.message : 'Could not load document.'));},[load]));
  const run = async (action:()=>Promise<unknown>) => {
    if (running.current) return;
    running.current=true;setBusy(true);setError(null);
    try {await action();await load();} catch(e) {setError(e instanceof Error ? e.message : 'Signing action failed.');} finally {running.current=false;setBusy(false);}
  };
  if (!document) return <Text selectable>{error ?? 'Loading signing details…'}</Text>;
  const locked = busy || document.documentState !== 'finalized';
  return <>
    <Stack.Screen options={{title:importing?'Import Signed PDF':'Sign Document'}} />
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{padding:18,gap:18,paddingBottom:44}}>
    <View style={{backgroundColor:colors.brandNavy,padding:18,borderRadius:18,gap:8}}>
      <Text selectable style={{color:'#fff',fontSize:22,fontWeight:'800'}}>{document.documentNumber}</Text>
      <Text selectable style={{color:'#fff'}}>{document.customerName}</Text>
      <Text selectable style={{color:'#fff'}}>Revision 1 · Fingerprint {document.fingerprint}</Text>
      <Text selectable style={{color:'#fff'}}>Current: {document.signatureStatus.replaceAll('_',' ')} · {document.documentState}</Text>
    </View>
    {importing ? <>
      <Text selectable style={{fontWeight:'700'}}>Import the customer's signed copy</Text>
      <Text>Share the original PDF from the document screen, send it to the customer, then import the returned PDF here. Before importing, check its document number, revision, and fingerprint against the details above. This is a manual match, not cryptographic signature verification; the original and returned files are both kept.</Text>
      <View style={{flexDirection:'row',alignItems:'center',gap:12}}><Switch accessibilityLabel="I checked the returned document number, revision and fingerprint" disabled={locked} value={matched} onValueChange={setMatched}/><Text style={{flex:1}}>I checked that the returned PDF matches this document.</Text></View>
      <ActionButton disabled={locked || !matched} onPress={() => void run(async () => {await pickAndAttachSignedPdf(db,ownerType,ownerId,document.fingerprint);setMatched(false);})}>Choose signed PDF to import</ActionButton>
      <Text selectable style={{fontWeight:'700'}}>Previously imported signed PDFs</Text>
      {document.attachments.length ? document.attachments.map(attachment => <ActionButton key={attachment.id} disabled={busy} variant="secondary" onPress={() => void run(() => shareSignedAttachment(attachment))}>Share {attachment.filename}</ActionButton>) : <Text>No signed PDF has been imported for this document yet.</Text>}
    </> : <>
      <Text selectable style={{fontWeight:'700'}}>Capture an in-person signature</Text>
      <Text>Review the original PDF with the signer first. Each capture is retained; signed copies include a separate acknowledgment page and leave the original unchanged.</Text>
      {(['customer','preparer'] as const).map(role => <ActionButton key={role} disabled={locked} onPress={() => router.push({pathname:'/signatures/capture',params:{ownerType,ownerId,role}})}>Draw {role} signature</ActionButton>)}
      {captures.map(capture => <View key={capture.id} style={{gap:8,padding:12,borderWidth:1,borderColor:colors.separator,borderRadius:12}}>
        <Text selectable>{capture.signer_name} · {capture.role}</Text>
        <Text selectable>{new Date(capture.created_at).toLocaleString()} · PDF {capture.pdf_state}</Text>
        <ActionButton variant="secondary" disabled={busy} onPress={() => void run(async () => {
          const path = await renderSignaturePdf(db,capture.id);
          await shareSignedAttachment({id:capture.id,filename:capture.deterministic_filename!,privatePath:path,checksum:capture.checksum??'',createdAt:capture.created_at});
        })}>Render / share this signed version</ActionButton>
      </View>)}
      <Text selectable style={{fontWeight:'700'}}>Record signing status</Text>
      <Text>Changing status does not delete signatures or returned files.</Text>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{STATUSES.map(entry => <ActionButton compact key={entry.value} variant={document.signatureStatus === entry.value ? 'primary' : 'secondary'} disabled={locked} onPress={() => void run(() => setDocumentSignatureStatus(db,ownerType,ownerId,entry.value))}>{entry.label}</ActionButton>)}</View>
    </>}
    {error ? <Text selectable style={{color:colors.error}}>{error}</Text> : null}
    </ScrollView>
  </>;
}
