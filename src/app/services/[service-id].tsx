import { useLocalSearchParams } from 'expo-router';

import { ServiceDetailView } from '@/features/services/service-detail-view';

export default function ServiceDetailScreen() {
  const { 'service-id': serviceId } = useLocalSearchParams<{ 'service-id': string }>();
  if (!serviceId) return null;
  return <ServiceDetailView serviceId={serviceId} />;
}
