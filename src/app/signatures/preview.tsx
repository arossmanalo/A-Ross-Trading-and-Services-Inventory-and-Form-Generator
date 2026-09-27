import { useLocalSearchParams } from 'expo-router';
import { DocumentPreviewScreen } from '@/components/document-preview-screen';

export default function SignedDocumentPreviewRoute() {
  const { captureId, kind, ownerId, pending } = useLocalSearchParams<{ captureId?: string; kind?: 'csr' | 'billing_statement'; ownerId?: string; pending?: string }>();
  return <DocumentPreviewScreen documentId={ownerId ?? ''} kind={kind === 'billing_statement' ? 'billing_statement' : 'csr'} signedCaptureId={captureId} signatureDraft={pending === 'true'} />;
}
