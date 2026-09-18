import { useLocalSearchParams } from 'expo-router';

import { DocumentPreviewScreen } from '@/components/document-preview-screen';

export default function BillingStatementPreviewRoute() {
  const { statementId } = useLocalSearchParams<{ statementId: string }>();
  return <DocumentPreviewScreen documentId={statementId ?? ''} kind="billing_statement" />;
}
