import { useLocalSearchParams } from 'expo-router';

import { BillingStatementDetailView } from '@/features/billing-statements/billing-statement-detail-view';

export default function BillingStatementDetailScreen() {
  const { 'statement-id': statementId } = useLocalSearchParams<{ 'statement-id': string }>();
  if (!statementId) return null;
  return <BillingStatementDetailView statementId={statementId} />;
}
