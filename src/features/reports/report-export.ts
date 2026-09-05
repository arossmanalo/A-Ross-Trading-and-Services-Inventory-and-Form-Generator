import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import { financialReportCsv, type FinancialReport, type ReportFilter } from '@/features/reports/financial-report';

export async function shareFinancialReport(report: FinancialReport, filter: ReportFilter, customerName: string): Promise<void> {
  return shareCsvReport(financialReportCsv(report,filter,customerName),`financial-${filter.from}-${filter.to}`);
}

export async function shareCsvReport(csv: string, name: string): Promise<void> {
  if (!FileSystem.cacheDirectory || !(await Sharing.isAvailableAsync())) throw new Error('Report sharing is unavailable on this device.');
  const path=`${FileSystem.cacheDirectory}${name.replace(/[^a-zA-Z0-9-]/g,'-')}-${Crypto.randomUUID()}.csv`;
  await FileSystem.writeAsStringAsync(path,csv,{encoding:FileSystem.EncodingType.UTF8});
  await Sharing.shareAsync(path,{mimeType:'text/csv',dialogTitle:'Share report',UTI:'public.comma-separated-values-text'});
}
