import { useLocalSearchParams } from 'expo-router';

import { DocumentPreviewScreen } from '@/components/document-preview-screen';

export default function QuotationPreviewRoute() {
  const { quotationId } = useLocalSearchParams<{ quotationId: string }>();
  return <DocumentPreviewScreen documentId={quotationId ?? ''} kind="quotation" />;
}
