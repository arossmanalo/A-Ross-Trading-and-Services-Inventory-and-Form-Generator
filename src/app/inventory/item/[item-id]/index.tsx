import { useLocalSearchParams } from 'expo-router';

import { InventoryItemDetailView } from '@/features/inventory/inventory-item-detail-view';

export default function InventoryItemDetailScreen() {
  const { 'item-id': itemId } = useLocalSearchParams<{ 'item-id': string }>();
  if (!itemId) return null;
  return <InventoryItemDetailView itemId={itemId} />;
}
