import { useLocalSearchParams } from 'expo-router';

import { QuotationDetailView } from '@/features/quotations/quotation-detail-view';

export default function QuotationDetailScreen() {
  const { 'quotation-id': quotationId } = useLocalSearchParams<{ 'quotation-id': string }>();
  if (!quotationId) return null;
  return <QuotationDetailView quotationId={quotationId} />;
}
