import { useLocalSearchParams } from 'expo-router';

import { ServiceReportDetailView } from '@/features/service-reports/service-report-detail-view';

export default function ServiceReportDetailScreen() {
  const { 'report-id': reportId } = useLocalSearchParams<{ 'report-id': string }>();
  if (!reportId) return null;
  return <ServiceReportDetailView reportId={reportId} />;
}
