import { useLocalSearchParams } from 'expo-router';

import { DeliveryDetailView } from '@/features/deliveries/delivery-detail-view';

export default function DeliveryDetailScreen() {
  const { 'delivery-id': deliveryId } = useLocalSearchParams<{ 'delivery-id': string }>();
  if (!deliveryId) return null;
  return <DeliveryDetailView deliveryId={deliveryId} />;
}
