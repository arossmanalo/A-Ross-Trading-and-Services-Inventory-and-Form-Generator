import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { PageBody, PageSection } from '@/components/page-section';
import { Fact, Panel, RecordHeader } from '@/components/record-layout';
import { SheetMessage } from '@/components/sheet-body';
import { StatusChip, sentenceCase } from '@/components/status-chip';
import { resolveShareFileName } from '@/features/documents/share-file-name';
import { listSignatureCaptures, type SignatureCapture } from '@/features/signatures/capture-repository';
import { listSignatureDrafts, type SignatureDraft } from '@/features/signatures/signature-draft-repository';
import { isSignableOwnerType, signableOwner } from '@/features/signatures/signable-owners';
import { getSignableDocument, pickAndAttachSignedPdf, setDocumentSignatureStatus, shareSignedAttachment } from '@/features/signatures/signature-repository';
import type { SignableDocument, SignableOwnerType, SignatureStatus } from '@/features/signatures/signature-types';
import { colors } from '@/theme/colors';
import { fontSize, spacing, text } from '@/theme/typography';

const STATUSES: Array<{value:Exclude<SignatureStatus,'signed_in_person'|'signed_document_attached'>;label:string}> = [{value:'not_required',label:'Not required'},{value:'pending',label:'Pending'},{value:'declined',label:'Declined'},{value:'no_response',label:'No response'}];

export default function ManageSignaturesScreen() {
  const {ownerType,ownerId,mode} = useLocalSearchParams<{ownerType:SignableOwnerType;ownerId:string;mode?:'sign'|'import'|'preview'}>();
  const importing = mode === 'import';
  const previewing = mode === 'preview';
  const db = useSQLiteContext();
  const [document,setDocument] = useState<SignableDocument|null>(null);
  const [captures,setCaptures] = useState<SignatureCapture[]>([]);
  const [drafts,setDrafts] = useState<SignatureDraft[]>([]);
  const [matched,setMatched] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [notice,setNotice] = useState('');
  const running = useRef(false);
  const load = useCallback(async () => {
    if (!ownerId || !isSignableOwnerType(ownerType)) throw new Error('Invalid signing target.');
    setDocument(await getSignableDocument(db,ownerType,ownerId));
    setCaptures(await listSignatureCaptures(db,ownerType,ownerId));
    setDrafts(await listSignatureDrafts(db,ownerType,ownerId));
  },[db,ownerType,ownerId]);
  useFocusEffect(useCallback(() => {setMatched(false);void load().catch((e:unknown) => setError(e instanceof Error ? e.message : 'Could not load document.'));},[load]));
  const run = async (action:()=>Promise<unknown>) => {
    if (running.current) return;
    running.current=true;setBusy(true);setError(null);setNotice('');
    try {await action();await load();} catch(e) {setError(e instanceof Error ? e.message : 'Signing action failed.');} finally {running.current=false;setBusy(false);}
  };
  if (!document) return <SheetMessage>{error ?? 'Loading signing details…'}</SheetMessage>;
  const locked = busy || document.documentState !== 'finalized';
  const currentCaptures = new Map<SignatureCapture['role'], SignatureCapture>();
  for (const capture of captures) if (!currentCaptures.has(capture.role)) currentCaptures.set(capture.role, capture);
  const legacyDuplicateCount = captures.length - currentCaptures.size;
  const latestInPersonVersion = captures[0] ?? null;
  const hasSignedArtifact = captures.length > 0 || document.attachments.length > 0;
  const previewKind = signableOwner(document.ownerType).previewKind;

  const returnedPdfs = document.attachments.map((attachment, index) => (
    <View key={attachment.id} style={styles.attachment}>
      <Text selectable style={[text.body, styles.attachmentName]}>{attachment.filename}</Text>
      <View style={styles.inlineActions}>
        <ActionButton
          compact
          variant="secondary"
          disabled={busy}
          onPress={() => void run(async () => {
            await Print.printAsync({ uri: attachment.privatePath });
            setNotice('Returned signed PDF preview opened.');
          })}
        >
          Preview returned PDF
        </ActionButton>
        <ActionButton
          compact
          variant="secondary"
          disabled={busy}
          onPress={() => void run(async () => shareSignedAttachment(
            attachment,
            await resolveShareFileName(
              db,
              document.ownerType,
              document.ownerId,
              document.attachments.length > 1 ? `Signed ${document.attachments.length - index}` : 'Signed',
            ),
          ))}
        >
          Share returned PDF
        </ActionButton>
      </View>
    </View>
  ));

  return (
    <>
      <Stack.Screen options={{ title: importing ? 'Import Signed PDF' : previewing ? 'Preview Signed Version' : 'Sign Document' }} />
      <PageBody>
        <RecordHeader
          title={document.documentNumber}
          chips={<StatusChip label={sentenceCase(document.signatureStatus.replaceAll('_', ' '))} tone="accent" />}
          subtitle={`${document.customerName} · Revision 1 · ${document.documentState}`}
        />
        <Fact label="Fingerprint">{document.fingerprint}</Fact>

        {importing ? (
          <>
            <PageSection
              title="Import the customer's signed copy"
              description="Share the original PDF from the document screen, send it to the customer, then import the returned PDF here. Before importing, check its document number, revision, and fingerprint against the details above. This is a manual match, not cryptographic signature verification; the original and returned files are both kept."
            >
              <View style={styles.matchRow}>
                <Switch
                  accessibilityLabel="I checked the returned document number, revision and fingerprint"
                  disabled={locked}
                  value={matched}
                  onValueChange={setMatched}
                />
                <Text style={[text.body, styles.flex]}>I checked that the returned PDF matches this document.</Text>
              </View>
              <ActionButton
                disabled={locked || !matched}
                style={styles.start}
                onPress={() => void run(async () => {
                  await pickAndAttachSignedPdf(db, ownerType, ownerId, document.fingerprint);
                  setMatched(false);
                })}
              >
                Choose signed PDF to import
              </ActionButton>
            </PageSection>
            <PageSection title="Previously imported signed PDFs">
              {document.attachments.length
                ? <Panel>{returnedPdfs}</Panel>
                : <Text style={text.meta}>No signed PDF has been imported for this document yet.</Text>}
            </PageSection>
          </>
        ) : previewing ? (
          <>
            <PageSection title="In-person signed version">
              {drafts.length ? (
                <>
                  <Text style={text.body}>
                    Review the staged signature{drafts.length > 1 ? 's' : ''} before committing. You can return to Sign Document and redraw either draft.
                  </Text>
                  <ActionButton
                    disabled={busy}
                    style={styles.start}
                    onPress={() => router.push({ pathname: '/signatures/preview', params: { ownerType, ownerId, kind: previewKind, pending: 'true' } })}
                  >
                    Preview and finalize signature
                  </ActionButton>
                </>
              ) : latestInPersonVersion ? (
                <>
                  <Text style={text.body}>
                    The latest signed copy is linked to this finalized document. It includes the most recent customer and preparer captures, if present. The original finalized PDF remains unchanged.
                  </Text>
                  <Text selectable style={text.meta}>
                    {latestInPersonVersion.signer_name} · {latestInPersonVersion.role} · PDF {latestInPersonVersion.pdf_state}
                  </Text>
                  <ActionButton
                    disabled={busy}
                    style={styles.start}
                    onPress={() => router.push({ pathname: '/signatures/preview', params: { captureId: latestInPersonVersion.id, kind: previewKind } })}
                  >
                    Preview signed version
                  </ActionButton>
                </>
              ) : (
                <Text style={text.meta}>No in-person signature has been captured for this document yet.</Text>
              )}
            </PageSection>
            <PageSection title="Customer-returned signed PDFs">
              {document.attachments.length
                ? <Panel>{returnedPdfs}</Panel>
                : <Text style={text.meta}>No customer-returned signed PDF has been imported.</Text>}
              {!latestInPersonVersion && !document.attachments.length
                ? <Text style={text.meta}>No signed version is available yet.</Text>
                : null}
            </PageSection>
          </>
        ) : (
          <>
            <PageSection
              title="Capture an in-person signature"
              description="Only one customer and one preparer signature can be finalized for this document. Drafts can be redrawn before finalization. The original finalized PDF remains unchanged."
            >
              <Panel>
                {(['customer', 'preparer'] as const).map((role) => {
                  const capture = currentCaptures.get(role);
                  const draft = drafts.find((entry) => entry.role === role);
                  const roleLabel = role === 'customer' ? 'Customer' : 'Preparer';
                  return (
                    <View key={role} style={styles.roleRow}>
                      <View style={styles.flex}>
                        <Text style={text.bodyStrong}>{roleLabel} signature</Text>
                        {capture ? (
                          <Text selectable style={text.meta}>
                            Captured · {capture.signer_name} · {new Date(capture.created_at).toLocaleString()}
                          </Text>
                        ) : draft ? (
                          <Text selectable style={text.meta}>{draft.signer_name} · draft saved</Text>
                        ) : (
                          <Text style={text.meta}>Not signed yet</Text>
                        )}
                      </View>
                      {capture ? (
                        <StatusChip label="Captured" tone="final" />
                      ) : (
                        <ActionButton
                          compact
                          disabled={locked}
                          onPress={() => router.push({ pathname: '/signatures/capture', params: { ownerType, ownerId, role } })}
                        >
                          {draft ? `Redraw ${role} signature` : `Draw ${role} signature`}
                        </ActionButton>
                      )}
                    </View>
                  );
                })}
              </Panel>
              {legacyDuplicateCount > 0 ? (
                <Text selectable style={text.meta}>
                  There are {legacyDuplicateCount} older duplicate capture(s) from before the one-per-role limit. They remain in the audit history; only the latest signature for each role is used in the signed version.
                </Text>
              ) : null}
              {drafts.length ? (
                <ActionButton
                  variant="secondary"
                  disabled={busy}
                  style={styles.start}
                  onPress={() => router.push({ pathname: '/signatures/preview', params: { ownerType, ownerId, kind: previewKind, pending: 'true' } })}
                >
                  Preview and finalize signature
                </ActionButton>
              ) : latestInPersonVersion ? (
                <ActionButton
                  variant="secondary"
                  disabled={busy}
                  style={styles.start}
                  onPress={() => router.push({ pathname: '/signatures/manage', params: { ownerType, ownerId, mode: 'preview' } })}
                >
                  Preview signed version
                </ActionButton>
              ) : null}
            </PageSection>
            <PageSection title="Record signing status" description="Changing status does not delete signatures or returned files.">
              {!hasSignedArtifact ? (
                <View style={styles.inlineActions}>
                  {STATUSES.map((entry) => (
                    <ActionButton
                      compact
                      key={entry.value}
                      variant={document.signatureStatus === entry.value ? 'primary' : 'secondary'}
                      disabled={locked}
                      onPress={() => void run(() => setDocumentSignatureStatus(db, ownerType, ownerId, entry.value))}
                    >
                      {entry.label}
                    </ActionButton>
                  ))}
                </View>
              ) : (
                <Text selectable style={text.meta}>Signing status is locked because a signed version is already attached or captured.</Text>
              )}
            </PageSection>
          </>
        )}
        {error ? <Text selectable style={text.error}>{error}</Text> : null}
        {notice ? <Text selectable style={styles.notice}>{notice}</Text> : null}
      </PageBody>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  start: { alignSelf: 'flex-start' },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  inlineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  attachment: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  attachmentName: { fontVariant: ['tabular-nums'] },
  roleRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  notice: { color: colors.success, fontSize: fontSize.meta, lineHeight: 18, fontWeight: '600' },
});
