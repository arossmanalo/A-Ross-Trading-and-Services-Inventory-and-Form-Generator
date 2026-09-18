import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
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
  const {ownerType,ownerId,mode} = useLocalSearchParams<{ownerType:SignableOwnerType;ownerId:string;mode?:'sign'|'import'|'preview'}>();
  const importing = mode === 'import';
  const previewing = mode === 'preview';
  const db = useSQLiteContext();
  const [document,setDocument] = useState<SignableDocument|null>(null);
  const [captures,setCaptures] = useState<SignatureCapture[]>([]);
  const [matched,setMatched] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [notice,setNotice] = useState('');
  const running = useRef(false);
  const load = useCallback(async () => {
    if (!ownerId || !['service_report','billing_statement'].includes(ownerType)) throw new Error('Invalid signing target.');
    setDocument(await getSignableDocument(db,ownerType,ownerId));
    setCaptures(await listSignatureCaptures(db,ownerType,ownerId));
  },[db,ownerType,ownerId]);
  useFocusEffect(useCallback(() => {setMatched(false);void load().catch((e:unknown) => setError(e instanceof Error ? e.message : 'Could not load document.'));},[load]));
  const run = async (action:()=>Promise<unknown>) => {
    if (running.current) return;
    running.current=true;setBusy(true);setError(null);setNotice('');
    try {await action();await load();} catch(e) {setError(e instanceof Error ? e.message : 'Signing action failed.');} finally {running.current=false;setBusy(false);}
  };
  if (!document) return <Text selectable>{error ?? 'Loading signing details…'}</Text>;
  const locked = busy || document.documentState !== 'finalized';
  const currentCaptures = new Map<SignatureCapture['role'],SignatureCapture>();
  for (const capture of captures) if (!currentCaptures.has(capture.role)) currentCaptures.set(capture.role,capture);
  const legacyDuplicateCount = captures.length - currentCaptures.size;
  const latestInPersonVersion = captures[0] ?? null;
  const hasSignedArtifact = captures.length > 0 || document.attachments.length > 0;
  return <>
    <Stack.Screen options={{title:importing?'Import Signed PDF':previewing?'Preview Signed Version':'Sign Document'}} />
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
      {document.attachments.length ? document.attachments.map(attachment => <View key={attachment.id} style={{gap:8,padding:12,borderWidth:1,borderColor:colors.separator,borderRadius:12}}>
        <Text selectable>{attachment.filename}</Text>
        <ActionButton variant="secondary" disabled={busy} onPress={() => void run(async () => {await Print.printAsync({uri:attachment.privatePath});setNotice('Returned signed PDF preview opened.');})}>Preview returned PDF</ActionButton>
        <ActionButton variant="secondary" disabled={busy} onPress={() => void run(() => shareSignedAttachment(attachment))}>Share returned PDF</ActionButton>
      </View>) : <Text>No signed PDF has been imported for this document yet.</Text>}
    </> : previewing ? <>
      <Text selectable style={{fontWeight:'700'}}>In-person signed version</Text>
      {latestInPersonVersion ? <>
        <Text>The latest signed copy is linked to this finalized document. It includes the most recent customer and preparer captures, if present. The original finalized PDF remains unchanged.</Text>
        <Text selectable>{latestInPersonVersion.signer_name} · {latestInPersonVersion.role} · PDF {latestInPersonVersion.pdf_state}</Text>
        <ActionButton disabled={busy} onPress={() => void run(async () => {
          const path = await renderSignaturePdf(db,latestInPersonVersion.id);
          await Print.printAsync({uri:path});
          setNotice('Signed version preview opened.');
        })}>Preview signed version</ActionButton>
        <ActionButton variant="secondary" disabled={busy} onPress={() => void run(async () => {
          const path = await renderSignaturePdf(db,latestInPersonVersion.id);
          await shareSignedAttachment({id:latestInPersonVersion.id,filename:latestInPersonVersion.deterministic_filename!,privatePath:path,checksum:latestInPersonVersion.checksum??'',createdAt:latestInPersonVersion.created_at});
        })}>Share signed version</ActionButton>
      </> : <Text>No in-person signature has been captured for this document yet.</Text>}
      <Text selectable style={{fontWeight:'700'}}>Customer-returned signed PDFs</Text>
      {document.attachments.length ? document.attachments.map(attachment => <View key={attachment.id} style={{gap:8,padding:12,borderWidth:1,borderColor:colors.separator,borderRadius:12}}>
        <Text selectable>{attachment.filename}</Text>
        <ActionButton variant="secondary" disabled={busy} onPress={() => void run(async () => {await Print.printAsync({uri:attachment.privatePath});setNotice('Returned signed PDF preview opened.');})}>Preview returned PDF</ActionButton>
        <ActionButton variant="secondary" disabled={busy} onPress={() => void run(() => shareSignedAttachment(attachment))}>Share returned PDF</ActionButton>
      </View>) : <Text>No customer-returned signed PDF has been imported.</Text>}
      {!latestInPersonVersion && !document.attachments.length ? <Text>No signed version is available yet.</Text> : null}
    </> : <>
      <Text selectable style={{fontWeight:'700'}}>Capture an in-person signature</Text>
      <Text>Only one customer and one preparer signature can be captured for this document. Signed copies are append-only and do not alter the original finalized PDF.</Text>
      {(['customer','preparer'] as const).map(role => {
        const capture = currentCaptures.get(role);
        return capture ? <View key={role} style={{gap:8,padding:12,borderWidth:1,borderColor:colors.separator,borderRadius:12}}>
          <Text selectable>{role === 'customer' ? 'Customer signature captured' : 'Preparer signature captured'}</Text>
          <Text selectable>{capture.signer_name} · {new Date(capture.created_at).toLocaleString()}</Text>
        </View> : <ActionButton key={role} disabled={locked} onPress={() => router.push({pathname:'/signatures/capture',params:{ownerType,ownerId,role}})}>Draw {role} signature</ActionButton>;
      })}
      {legacyDuplicateCount > 0 ? <Text selectable style={{color:colors.secondaryLabel}}>There are {legacyDuplicateCount} older duplicate capture(s) from before the one-per-role limit. They remain in the audit history; only the latest signature for each role is used in the signed version.</Text> : null}
      {latestInPersonVersion ? <ActionButton variant="secondary" disabled={busy} onPress={() => router.push({pathname:'/signatures/manage',params:{ownerType,ownerId,mode:'preview'}})}>Preview signed version</ActionButton> : null}
      {!hasSignedArtifact ? <>
        <Text selectable style={{fontWeight:'700'}}>Record signing status</Text>
        <Text>Changing status does not delete signatures or returned files.</Text>
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{STATUSES.map(entry => <ActionButton compact key={entry.value} variant={document.signatureStatus === entry.value ? 'primary' : 'secondary'} disabled={locked} onPress={() => void run(() => setDocumentSignatureStatus(db,ownerType,ownerId,entry.value))}>{entry.label}</ActionButton>)}</View>
      </> : <Text selectable>Signing status is locked because a signed version is already attached or captured.</Text>}
    </>}
    {error ? <Text selectable style={{color:colors.error}}>{error}</Text> : null}
    {notice ? <Text selectable style={{color:colors.success}}>{notice}</Text> : null}
    </ScrollView>
  </>;
}
