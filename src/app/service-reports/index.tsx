import { Link, router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { listServiceReports } from '@/features/service-reports/service-report-repository';
import type { ServiceReportSummary } from '@/features/service-reports/service-report-types';
import { colors } from '@/theme/colors';

const ReportRow = memo(function ReportRow({ report }: { report: ServiceReportSummary }) {
  const openReport = useCallback(() => {
    router.push({ pathname: '/service-reports/[report-id]', params: { 'report-id': report.id } });
  }, [report.id]);
  return (
    <Pressable accessibilityRole="button" onPress={openReport} style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>
      <View style={styles.rowCopy}>
        <View style={styles.titleLine}>
          <Text selectable style={styles.number}>{report.csrNumber ?? 'DRAFT'}</Text>
          <Text selectable style={report.documentState === 'draft' ? styles.draftBadge : styles.finalBadge}>
            {report.documentState.toUpperCase()}
          </Text>
        </View>
        <Text selectable style={styles.customer}>{report.customerName}</Text>
        <Text selectable style={styles.meta}>{report.equipmentName} · {report.businessDate}</Text>
      </View>
      <View style={styles.stateCopy}>
        <Text selectable style={styles.outcome}>{formatOutcome(report.serviceOutcome)}</Text>
        {report.documentState === 'finalized' ? <Text selectable style={styles.pdfState}>PDF {report.pdfState}</Text> : null}
      </View>
    </Pressable>
  );
});

export default function ServiceReportsScreen() {
  const db = useSQLiteContext();
  const [reports, setReports] = useState<ServiceReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReports(await listServiceReports(db));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load service reports.');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(useCallback(() => {
    void loadReports();
  }, [loadReports]));

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={reports.length ? styles.content : styles.emptyContent}
      data={reports}
      keyExtractor={(report) => report.id}
      renderItem={({ item }) => <ReportRow report={item} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      refreshing={loading && reports.length > 0}
      onRefresh={loadReports}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text selectable style={styles.eyebrow}>CUSTOMER SERVICE REPORTS</Text>
          <Text selectable style={styles.headerText}>Drafts are unnumbered. Stock posts only when a CSR is finalized.</Text>
          <Link href="/service-reports/new" asChild>
            <Pressable accessibilityRole="button" style={styles.newButton}>
              <Text selectable style={styles.newButtonText}>New CSR draft</Text>
            </Pressable>
          </Link>
          {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={loading ? <ActivityIndicator color={colors.brandBlue} size="large" /> : (
        <View style={styles.emptyState}>
          <Text selectable style={styles.emptyTitle}>No service reports yet</Text>
          <Text selectable style={styles.emptyBody}>Create the first unnumbered draft for a registered customer and equipment record.</Text>
        </View>
      )}
    />
  );
}

function formatOutcome(value: string) {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingBottom: 44 },
  emptyContent: { flexGrow: 1, paddingHorizontal: 18, paddingBottom: 44 },
  header: { gap: 10, paddingVertical: 18 },
  eyebrow: { color: colors.brandBlue, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  headerText: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 },
  newButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandBlue, borderRadius: 14, borderCurve: 'continuous' },
  newButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  row: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  rowCopy: { flex: 1, gap: 4 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  number: { color: colors.label, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  draftBadge: { color: colors.warning, fontSize: 8, fontWeight: '900', letterSpacing: .7 },
  finalBadge: { color: colors.success, fontSize: 8, fontWeight: '900', letterSpacing: .7 },
  customer: { color: colors.label, fontSize: 15, fontWeight: '700' },
  meta: { color: colors.secondaryLabel, fontSize: 12 },
  stateCopy: { maxWidth: 105, alignItems: 'flex-end', gap: 5 },
  outcome: { color: colors.brandNavy, fontSize: 11, fontWeight: '700', textAlign: 'right' },
  pdfState: { color: colors.secondaryLabel, fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 28 },
  emptyTitle: { color: colors.label, fontSize: 20, fontWeight: '900' },
  emptyBody: { maxWidth: 330, color: colors.secondaryLabel, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  errorText: { color: colors.error, fontSize: 13, lineHeight: 18 },
  pressed: { opacity: .72 },
});
