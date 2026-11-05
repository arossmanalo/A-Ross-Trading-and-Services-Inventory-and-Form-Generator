import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { requestPermissionsAsync, saveToLibraryAsync } from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import { captureRef, releaseCapture } from 'react-native-view-shot';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { ActionButton } from '@/components/action-button';
import { getBillingStatementPreview, listShareableStatementsForReport } from '@/features/billing-statements/billing-statement-pdf';
import { base64ToBytes, bytesToBase64 } from '@/features/backup/zip';
import { mergePdfs } from '@/features/documents/pdf-merge';
import { printHtmlToPdf } from '@/features/documents/pdf-output';
import { combinePreviewPages } from '@/features/documents/preview-pages';
import { resolveShareFileName } from '@/features/documents/share-file-name';
import { sharePdfFiles } from '@/features/documents/share-pdf';
import { getServiceReportPreview } from '@/features/service-reports/service-report-pdf';
import { withDocumentHeaderLayout } from '@/features/documents/document-header';
import { getSignatureCapturePreview } from '@/features/signatures/capture-repository';
import { renderSignaturePdf } from '@/features/signatures/capture-pdf';
import { finalizeSignatureDrafts, getSignatureDraftPreview } from '@/features/signatures/signature-draft-repository';
import { DOCUMENT_KINDS } from '@/features/documents/document-kinds';
import { getQuotationPreview } from '@/features/quotations/quotation-pdf';
import type { PreviewKind } from '@/features/signatures/signable-owners';
import type { SignableOwnerType } from '@/features/signatures/signature-types';
import { colors } from '@/theme/colors';

type DocumentKind = PreviewKind;
type PagePreview = { html: string; kind: DocumentKind };
/** `pages` is every page of the PDF that is sent, in order; it includes this document. */
type PreviewData = { number: string; html: string; isDraft: boolean; pages: PagePreview[] };
type CaptureView = View & { measure?: unknown };

const MAX_IMAGE_HEIGHT = 6_000;

/** Renders a portrait PDF at the document's page size, whatever the tablet's current rotation. */
async function renderPdf(html: string, documentKind: DocumentKind): Promise<string> {
  const file = await printHtmlToPdf(html, DOCUMENT_KINDS[documentKind].pageSize);
  return file.uri;
}

/** Renders every page and, when there are several, merges them into the one PDF that is sent. */
async function renderPagesPdf(pages: readonly PagePreview[]): Promise<string> {
  const uris: string[] = [];
  for (const page of pages) uris.push(await renderPdf(page.html, page.kind));
  if (uris.length === 1) return uris[0];
  if (!FileSystem.cacheDirectory) throw new Error('Temporary storage is unavailable on this device.');
  const parts: Uint8Array[] = [];
  for (const uri of uris) parts.push(base64ToBytes(await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })));
  const target = `${FileSystem.cacheDirectory}preview-merged-${Date.now()}.pdf`;
  await FileSystem.writeAsStringAsync(target, bytesToBase64(await mergePdfs(parts)), { encoding: FileSystem.EncodingType.Base64 });
  return target;
}

/**
 * The pages sent with a document: a finalized CSR is followed by its finalized
 * Billing Statements, and a finalized Billing Statement is preceded by its
 * finalized CSR. Each linked document uses its signed version when it has one.
 * Drafts and documents with no link go alone.
 */
async function collectLinkedPages(
  db: ReturnType<typeof useSQLiteContext>,
  kind: DocumentKind,
  documentId: string,
): Promise<{ before: PagePreview[]; after: PagePreview[] }> {
  const before: PagePreview[] = [];
  const after: PagePreview[] = [];
  if (kind === 'billing_statement') {
    const linked = await db.getFirstAsync<{ service_report_id: string | null; csr_state: string | null }>(
      'SELECT b.service_report_id, r.document_state AS csr_state FROM billing_statements b LEFT JOIN service_reports r ON r.id = b.service_report_id WHERE b.id = ?',
      documentId,
    );
    if (linked?.service_report_id && linked.csr_state === 'finalized') {
      const report = await getServiceReportPreview(db, linked.service_report_id);
      before.push({ html: withDocumentHeaderLayout(report.html), kind: 'csr' });
    }
  } else if (kind === 'csr') {
    for (const statement of await listShareableStatementsForReport(db, documentId)) {
      const preview = await getBillingStatementPreview(db, statement.id);
      after.push({ html: withDocumentHeaderLayout(preview.html), kind: 'billing_statement' });
    }
  }
  return { before, after };
}

/**
 * The generated document HTML uses a one-to-one viewport by default so that
 * printed output is stable. The on-device preview needs a wider range so a
 * user can pinch back out after zooming in, especially on tablets.
 */
function withPreviewViewport(html: string): string {
  const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=0.5, maximum-scale=4, user-scalable=yes" />';
  const viewportTag = /<meta\s+name=["']viewport["'][^>]*>/i;
  return viewportTag.test(html)
    ? html.replace(viewportTag, viewport)
    : html.replace(/<head>/i, `<head>${viewport}`);
}

export function DocumentPreviewScreen({ documentId, kind, signedCaptureId, signatureDraft = false }: { documentId: string; kind: DocumentKind; signedCaptureId?: string; signatureDraft?: boolean }) {
  const db = useSQLiteContext();
  const { width: windowWidth } = useWindowDimensions();
  const captureView = useRef<CaptureView>(null);
  const webViewRef = useRef<WebView>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [documentHeight, setDocumentHeight] = useState<number | null>(null);
  const [imageTooLong, setImageTooLong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [finalizedCaptureId, setFinalizedCaptureId] = useState<string | null>(null);
  const [confirmSignature, setConfirmSignature] = useState(false);
  const finalizing = useRef(false);
  const activeCaptureId = finalizedCaptureId ?? signedCaptureId;
  const reviewingSignature = signatureDraft && !finalizedCaptureId;
  const ownerType: SignableOwnerType = DOCUMENT_KINDS[kind].ownerType;
  // Rotating changes the page width, so the measured document height is stale.
  // Clearing it (and remounting the WebView below) re-measures at the new width.
  useEffect(() => {
    setDocumentHeight(null);
  }, [windowWidth]);
  const previewHtml = useMemo(
    () => withPreviewViewport(preview ? combinePreviewPages(preview.pages.map((page) => page.html)) : ''),
    [preview],
  );

  useEffect(() => {
    let active = true;
    setPreview(null);
    setError(null);
    setDocumentHeight(null);
    setImageTooLong(false);
    const load: Promise<{ number: string; html: string; isDraft: boolean }> = activeCaptureId
      ? getSignatureCapturePreview(db, activeCaptureId).then((value) => ({ number: value.number, html: value.html, isDraft: false }))
      : reviewingSignature
      ? getSignatureDraftPreview(db, ownerType, documentId).then((value) => ({ number: value.number, html: value.html, isDraft: false }))
      : kind === 'csr'
      ? getServiceReportPreview(db, documentId).then((value) => ({
          number: value.csrNumber,
          html: value.html,
          isDraft: value.isDraft,
        }))
      : kind === 'quotation'
      ? getQuotationPreview(db, documentId).then((value) => ({ number: value.qtNumber, html: value.html, isDraft: value.isDraft }))
      : getBillingStatementPreview(db, documentId).then((value) => ({
          number: value.bsNumber,
          html: value.html,
          isDraft: value.isDraft,
        }));
    void load
      .then(async (value) => {
        const own: PagePreview = { html: withDocumentHeaderLayout(value.html), kind };
        // The preview is exactly what is sent, so it includes the linked document's pages.
        const linked = value.isDraft || reviewingSignature
          ? { before: [], after: [] }
          : await collectLinkedPages(db, kind, documentId);
        if (active) setPreview({ ...value, html: own.html, pages: [...linked.before, own, ...linked.after] });
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load this document preview.');
      });
    return () => { active = false; };
  }, [db, documentId, kind, activeCaptureId, reviewingSignature, ownerType]);

  const finalizeSignature = useCallback(async () => {
    if (finalizing.current) return;
    finalizing.current = true;
    setConfirmSignature(false);
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const captureId = await finalizeSignatureDrafts(db, ownerType, documentId);
      setFinalizedCaptureId(captureId);
      setNotice(`Signature finalized. The signed version now appears in the ${DOCUMENT_KINDS[kind].label} PDF preview.`);
      // File generation is a retryable derived operation, not signature finalization.
      // Do not leave the finalization button busy while Android Print is working.
      void renderSignaturePdf(db, captureId).catch((renderError: unknown) => {
        setError(`Signature finalized, but its PDF file could not be generated yet: ${renderError instanceof Error ? renderError.message : 'Unknown error'}. The in-app signed preview is still available.`);
      });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not finalize the signature.');
    } finally {
      finalizing.current = false;
      setBusy(false);
    }
  }, [db, documentId, kind, ownerType]);

  const onDocumentMessage = useCallback((event: WebViewMessageEvent) => {
    const height = Number(event.nativeEvent.data);
    if (!Number.isFinite(height) || height <= 0) return;
    if (height > MAX_IMAGE_HEIGHT) {
      setImageTooLong(true);
      setDocumentHeight(null);
      return;
    }
    setImageTooLong(false);
    setDocumentHeight(Math.ceil(height));
  }, []);

  const generatePdf = useCallback(async () => {
    if (!preview) throw new Error('The document preview is not ready.');
    return renderPagesPdf(preview.pages);
  }, [preview]);

  const openPdfPreview = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const uri = await generatePdf();
      await Print.printAsync({ uri, orientation: Print.Orientation.portrait });
      setNotice(reviewingSignature ? 'Signature preview opened. It is not finalized yet.' : 'PDF preview opened.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not open the PDF preview.');
    } finally {
      setBusy(false);
    }
  }, [generatePdf, reviewingSignature]);

  const sharePdf = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      if (!preview) throw new Error('The document preview is not ready.');
      const fileName = await resolveShareFileName(db, DOCUMENT_KINDS[kind].shareKind, documentId);
      // The pages shown in the preview are the pages sent.
      const pages = preview.pages;
      const sourceUris: string[] = [];
      for (const page of pages) sourceUris.push(await renderPdf(page.html, page.kind));
      await sharePdfFiles({ sourceUris, fileName });
      setNotice(pages.length > 1
        ? 'The CSR and its Billing Statement were sent as one PDF.'
        : preview.isDraft ? 'PDF export opened. The document remains a draft until you finalize it.' : 'PDF export opened.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not export the PDF.');
    } finally {
      setBusy(false);
    }
  }, [db, documentId, kind, preview]);

  const saveImage = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice('');
    let captureUri: string | undefined;
    try {
      if (imageTooLong) throw new Error('This document is too long for one image. Use the PDF export instead.');
      if (!captureView.current || !documentHeight) throw new Error('Wait for the full document preview to finish loading.');
      const permission = await requestPermissionsAsync(true);
      if (permission.status !== 'granted') throw new Error('Photo-library permission is needed to save the document image.');
      const safeName = `${kind}-${preview?.number ?? 'draft'}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 70);
      captureUri = await captureRef(captureView, {
        fileName: safeName,
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      const localUri = captureUri.startsWith('file://') ? captureUri : `file://${captureUri}`;
      await saveToLibraryAsync(localUri);
      setNotice('Document image saved to Photos. It contains the customer information shown in this preview.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not save the document image.');
    } finally {
      if (captureUri) releaseCapture(captureUri);
      setBusy(false);
    }
  }, [documentHeight, imageTooLong, kind, preview?.number]);

  const heading = activeCaptureId || reviewingSignature ? 'Signed PDF Preview' : `${DOCUMENT_KINDS[kind].label} PDF Preview`;
  const pageTitle = preview?.number ? `${preview.number} Preview` : heading;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: pageTitle }} />
      {preview ? (
        <>
          <View style={styles.actions}>
            <ActionButton disabled={busy} onPress={() => void openPdfPreview()}>
              {busy ? 'Preparing…' : reviewingSignature ? 'Open print preview' : 'Print (opens print dialog)'}
            </ActionButton>
            {reviewingSignature ? <Button title={busy ? 'Finalizing…' : 'Finalize signature'} color={colors.brandBlue} disabled={busy} onPress={() => setConfirmSignature(true)} /> : <View style={styles.secondaryActions}>
              <ActionButton compact disabled={busy} variant="secondary" onPress={() => void sharePdf()}>
                Save / share PDF
              </ActionButton>
              <ActionButton compact disabled={busy || !documentHeight || imageTooLong} variant="secondary" onPress={() => void saveImage()}>
                Save image to Photos
              </ActionButton>
            </View>}
            <Text selectable style={styles.help}>
              {reviewingSignature ? 'Signature review only. Return to Sign Document to redraw it before finalizing.' : preview.isDraft ? 'Draft preview only — no number, stock movement, or payment is created.' : activeCaptureId ? 'Finalized signed document preview.' : 'Finalized document preview.'}
              {' '}Image export saves the full preview as one PNG; PDF keeps normal page breaks. To send a PDF use Save / share PDF; the print dialog follows the tablet's rotation and is meant for printing.
            </Text>
          </View>
          {error ? <Text selectable style={styles.error}>{error}</Text> : null}
          {notice ? <Text selectable style={styles.notice}>{notice}</Text> : null}
          {imageTooLong ? <Text selectable style={styles.help}>This document is too long for a single image. Use PDF export.</Text> : null}
          <ScrollView style={styles.previewScroll} contentContainerStyle={styles.previewContent}>
            <View
              ref={captureView}
              collapsable={false}
              style={[styles.capture, { width: Math.max(windowWidth - 24, 280), height: documentHeight ?? 700 }]}
            >
              <WebView
                key={Math.round(windowWidth)}
                ref={webViewRef}
                originWhitelist={['*']}
                javaScriptEnabled
                showsVerticalScrollIndicator={false}
                scrollEnabled={documentHeight === null}
                source={{ html: previewHtml }}
                onLoadEnd={() => webViewRef.current?.injectJavaScript(
                  'window.ReactNativeWebView.postMessage(String(document.documentElement.scrollHeight || document.body.scrollHeight)); true;',
                )}
                onMessage={onDocumentMessage}
                style={[styles.webview, documentHeight ? { height: documentHeight } : null]}
              />
            </View>
          </ScrollView>
        </>
      ) : (
        <View style={styles.centered}>
          {error ? <Text selectable style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.brandBlue} size="large" />}
        </View>
      )}
      <Modal visible={confirmSignature} transparent animationType="fade" onRequestClose={() => setConfirmSignature(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.confirmation} accessibilityViewIsModal>
            <Text style={styles.confirmationTitle}>Finalize signature?</Text>
            <Text>After finalizing, these signatures cannot be redrawn for this document. Its regular PDF preview will show the signed version.</Text>
            <Button title="Confirm finalization" color={colors.brandBlue} disabled={busy} onPress={() => void finalizeSignature()} />
            <Button title="Keep editing" color={colors.secondaryLabel} disabled={busy} onPress={() => setConfirmSignature(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  actions: { gap: 9, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10, backgroundColor: colors.background },
  secondaryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  help: { color: colors.secondaryLabel, fontSize: 11, lineHeight: 16 },
  previewScroll: { flex: 1 },
  previewContent: { alignItems: 'center', paddingHorizontal: 12, paddingBottom: 20 },
  capture: { overflow: 'hidden', backgroundColor: '#fff' },
  webview: { width: '100%', flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: colors.error, fontSize: 13, lineHeight: 19, paddingHorizontal: 14, paddingBottom: 8 },
  notice: { color: colors.success, fontSize: 12, lineHeight: 17, paddingHorizontal: 14, paddingBottom: 8 },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.5)' },
  confirmation: { alignSelf: 'center', width: '100%', maxWidth: 480, padding: 22, gap: 18, borderRadius: 18, backgroundColor: colors.background },
  confirmationTitle: { fontSize: 20, fontWeight: '700', color: colors.label },
});
