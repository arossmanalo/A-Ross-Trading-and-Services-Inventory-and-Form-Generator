import { useLocalSearchParams } from 'expo-router';

import { DocumentPreviewScreen } from '@/components/document-preview-screen';

export default function DeliveryPreviewRoute() {
  const { deliveryId } = useLocalSearchParams<{ deliveryId: string }>();
  return <DocumentPreviewScreen documentId={deliveryId ?? ''} kind="delivery" />;
}
