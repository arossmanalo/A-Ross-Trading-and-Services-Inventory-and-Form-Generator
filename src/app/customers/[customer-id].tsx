import { useLocalSearchParams } from 'expo-router';

import { CustomerDetailView } from '@/features/customers/customer-detail-view';

export default function CustomerDetailScreen() {
  const { 'customer-id': customerId } = useLocalSearchParams<{ 'customer-id': string }>();
  if (!customerId) return null;
  return <CustomerDetailView customerId={customerId} />;
}
