import { useLocalSearchParams } from 'expo-router';

import { PaymentDetailView } from '@/features/payments/payment-detail-view';

export default function PaymentDetailScreen() {
  const { 'payment-id': paymentId } = useLocalSearchParams<{ 'payment-id': string }>();
  if (!paymentId) return null;
  return <PaymentDetailView paymentId={paymentId} />;
}
