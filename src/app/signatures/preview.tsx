import { useLocalSearchParams } from 'expo-router';
import { DocumentPreviewScreen } from '@/components/document-preview-screen';
import { SIGNABLE_OWNERS, ownerTypeForPreviewKind, type PreviewKind } from '@/features/signatures/signable-owners';

export default function SignedDocumentPreviewRoute() {
  const { captureId, kind, ownerId, pending } = useLocalSearchParams<{ captureId?: string; kind?: PreviewKind; ownerId?: string; pending?: string }>();
  return <DocumentPreviewScreen documentId={ownerId ?? ''} kind={SIGNABLE_OWNERS[ownerTypeForPreviewKind(kind)].previewKind} signedCaptureId={captureId} signatureDraft={pending === 'true'} />;
}
