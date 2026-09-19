import { useLocalSearchParams } from 'expo-router';
import { DocumentPreviewScreen } from '@/components/document-preview-screen';

export default function SignedDocumentPreviewRoute() {
  const { captureId, kind } = useLocalSearchParams<{ captureId?: string; kind?: 'csr' | 'billing_statement' }>();
  return <DocumentPreviewScreen documentId="" kind={kind === 'billing_statement' ? 'billing_statement' : 'csr'} signedCaptureId={captureId} />;
}
