import { useLocalSearchParams } from 'expo-router';

import { DocumentPreviewScreen } from '@/components/document-preview-screen';

export default function ServiceReportPreviewRoute() {
  const { reportId } = useLocalSearchParams<{ reportId: string }>();
  return <DocumentPreviewScreen documentId={reportId ?? ''} kind="csr" />;
}
