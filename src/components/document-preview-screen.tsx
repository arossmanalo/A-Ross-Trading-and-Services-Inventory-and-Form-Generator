import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { requestPermissionsAsync, saveToLibraryAsync } from 'expo-media-library/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { captureRef, releaseCapture } from 'react-native-view-shot';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { ActionButton } from '@/components/action-button';
import { getBillingStatementPreview } from '@/features/billing-statements/billing-statement-pdf';
import { getServiceReportPreview } from '@/features/service-reports/service-report-pdf';
import { colors } from '@/theme/colors';

type DocumentKind = 'csr' | 'billing_statement';
type PreviewData = { number: string; html: string; isDraft: boolean };
type CaptureView = View & { measure?: unknown };

const MAX_IMAGE_HEIGHT = 6_000;

export function DocumentPreviewScreen({ documentId, kind }: { documentId: string; kind: DocumentKind }) {
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

  useEffect(() => {
    let active = true;
    setPreview(null);
    setError(null);
    setDocumentHeight(null);
    setImageTooLong(false);
    const load = kind === 'csr'
      ? getServiceReportPreview(db, documentId).then((value) => ({
          number: value.csrNumber,
          html: value.html,
          isDraft: value.isDraft,
        }))
      : getBillingStatementPreview(db, documentId).then((value) => ({
          number: value.bsNumber,
          html: value.html,
          isDraft: value.isDraft,
        }));
    void load
      .then((value) => { if (active) setPreview(value); })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load this document preview.');
      });
    return () => { active = false; };
  }, [db, documentId, kind]);

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
    const dimensions = kind === 'csr'
      ? { width: 612, height: 1008 }
      : { width: 595, height: 842 };
    const file = await Print.printToFileAsync({
      html: preview.html,
      ...dimensions,
      textZoom: 100,
    });
    return file.uri;
  }, [kind, preview]);

  const openPdfPreview = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const uri = await generatePdf();
      await Print.printAsync({ uri });
      setNotice('PDF preview opened. This does not finalize or number the document.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not open the PDF preview.');
    } finally {
      setBusy(false);
    }
  }, [generatePdf]);

  const sharePdf = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable on this device.');
      const uri = await generatePdf();
      await Sharing.shareAsync(uri, {
        dialogTitle: `Save or share ${kind === 'csr' ? 'CSR' : 'Billing Statement'} PDF`,
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
      });
      setNotice('PDF export opened. The document remains a draft until you finalize it.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not export the PDF.');
    } finally {
      setBusy(false);
    }
  }, [generatePdf, kind]);

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

  const heading = kind === 'csr' ? 'CSR PDF Preview' : 'Billing Statement PDF Preview';
  const pageTitle = preview?.number ? `${preview.number} Preview` : heading;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: pageTitle }} />
      {preview ? (
        <>
          <View style={styles.actions}>
            <ActionButton disabled={busy} onPress={() => void openPdfPreview()}>
              {busy ? 'Preparing…' : 'Open PDF preview'}
            </ActionButton>
            <View style={styles.secondaryActions}>
              <ActionButton compact disabled={busy} variant="secondary" onPress={() => void sharePdf()}>
                Save / share PDF
              </ActionButton>
              <ActionButton compact disabled={busy || !documentHeight || imageTooLong} variant="secondary" onPress={() => void saveImage()}>
                Save image to Photos
              </ActionButton>
            </View>
            <Text selectable style={styles.help}>
              {preview.isDraft ? 'Draft preview only — no number, stock movement, or payment is created.' : 'Finalized document preview.'}
              {' '}Image export saves the full preview as one PNG; PDF keeps normal page breaks.
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
                ref={webViewRef}
                originWhitelist={['*']}
                javaScriptEnabled
                showsVerticalScrollIndicator={false}
                scrollEnabled={documentHeight === null}
                source={{ html: preview.html }}
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
});
