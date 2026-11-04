import { Link, router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { DateRangeFields } from '@/components/date-range-fields';
import { Dropdown } from '@/components/dropdown';
import { FormField } from '@/components/form-field';
import { SalesTotalCard } from '@/components/sales-total-card';
import { getLocalBusinessDate } from '@/domain/business-date';
import { formatCentavos } from '@/domain/money';
import {
  BILLING_OPTIONS,
  DEFAULT_CRITERIA,
  OUTCOME_OPTIONS,
  PERIOD_OPTIONS,
  SORT_OPTIONS,
  STATE_OPTIONS,
  filterServiceReports,
  hasActiveFilters,
  sumServiceReportSales,
  type ServiceReportCriteria,
} from '@/features/service-reports/service-report-filter';
import { listServiceReports } from '@/features/service-reports/service-report-repository';
import type { ServiceReportListItem, ServiceReportSummary } from '@/features/service-reports/service-report-types';
import { colors } from '@/theme/colors';

const ReportRow = memo(function ReportRow({ report, showTotal }: { report: ServiceReportSummary; showTotal: boolean }) {
  const openReport = useCallback(() => {
    router.push({ pathname: '/service-reports/[report-id]', params: { 'report-id': report.id } });
  }, [report.id]);
  const billed = report.linkedStatements.filter((statement) => statement.documentState !== 'voided');
  return (
    <Pressable accessibilityRole="button" onPress={openReport} style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>
      <View style={styles.rowCopy}>
        <View style={styles.titleLine}>
          <Text selectable style={styles.number}>{report.csrNumber ?? 'DRAFT'}</Text>
          <Text selectable style={report.documentState === 'draft' ? styles.draftBadge : styles.finalBadge}>
            {report.documentState.toUpperCase()}
          </Text>
        </View>
        <Text selectable style={styles.total}>Total {showTotal ? formatCentavos(report.totalBillCentavos) : '₱ ••••••'}</Text>
        <Text selectable style={styles.customer}>{report.customerName}</Text>
        <Text selectable style={styles.meta}>{report.equipmentName} · {report.businessDate}</Text>
        {billed.length ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={billed.length === 1 ? `Open ${billed[0].bsNumber ?? 'draft Billing Statement'}` : 'Open this CSR to see its Billing Statements'}
            hitSlop={6}
            onPress={() => (billed.length === 1
              ? router.push({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': billed[0].id } })
              : openReport())}
            style={styles.billingChip}
          >
            <Text style={styles.billingChipText}>{billed[0].bsNumber ?? 'Draft statement'}{billed.length > 1 ? ` +${billed.length - 1} more` : ''} ›</Text>
          </Pressable>
        ) : null}
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
  const [reports, setReports] = useState<ServiceReportListItem[]>([]);
  const [criteria, setCriteria] = useState<ServiceReportCriteria>(DEFAULT_CRITERIA);
  const [showTotals, setShowTotals] = useState(true);
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

  const visible = useMemo(() => filterServiceReports(reports, criteria, getLocalBusinessDate()), [criteria, reports]);
  const filtered = hasActiveFilters(criteria);
  const sales = useMemo(() => sumServiceReportSales(visible), [visible]);
  const update = <K extends keyof ServiceReportCriteria>(key: K, value: ServiceReportCriteria[K]) => setCriteria((current) => ({ ...current, [key]: value }));

  const changePeriod = (period: ServiceReportCriteria['period']) => setCriteria((current) => {
    // Start a custom range on today so both calendars show a real date.
    const today = getLocalBusinessDate();
    return { ...current, period, from: period === 'custom' && !current.from ? today : current.from, to: period === 'custom' && !current.to ? today : current.to };
  });

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={visible.length ? styles.content : styles.emptyContent}
      data={visible}
      keyExtractor={(report) => report.id}
      extraData={showTotals}
      renderItem={({ item }) => <ReportRow report={item} showTotal={showTotals} />}
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
          <FormField
            autoCapitalize="none"
            autoCorrect={false}
            label="Search"
            onChangeText={(value) => update('query', value)}
            placeholder="CSR code, customer, machine, serial, BS number, problem…"
            returnKeyType="search"
            value={criteria.query}
          />
          <View style={styles.filters}>
            <Dropdown label="STATUS" value={criteria.state} options={STATE_OPTIONS} onChange={(value) => update('state', value)} />
            <Dropdown label="OUTCOME" value={criteria.outcome} options={OUTCOME_OPTIONS} onChange={(value) => update('outcome', value)} />
            <Dropdown label="BILLING" value={criteria.billing} options={BILLING_OPTIONS} onChange={(value) => update('billing', value)} />
            <Dropdown label="DATE" value={criteria.period} options={PERIOD_OPTIONS} onChange={changePeriod} />
            <Dropdown label="SORT BY" value={criteria.sort} options={SORT_OPTIONS} onChange={(value) => update('sort', value)} />
          </View>
          {criteria.period === 'custom' ? <DateRangeFields from={criteria.from} to={criteria.to} onChange={(range) => setCriteria((current) => ({ ...current, ...range }))} /> : null}
          <View style={styles.resultLine}>
            <Text selectable style={styles.headerText}>{visible.length} of {reports.length} service report{reports.length === 1 ? '' : 's'}</Text>
            <ActionButton compact variant="secondary" onPress={() => setShowTotals((current) => !current)}>{showTotals ? 'Hide totals' : 'Show totals'}</ActionButton>
            {filtered ? <ActionButton compact variant="secondary" onPress={() => setCriteria((current) => ({ ...DEFAULT_CRITERIA, sort: current.sort }))}>Clear filters</ActionButton> : null}
          </View>
          {filtered ? <SalesTotalCard totalCentavos={sales.totalCentavos} count={sales.count} noun="service report" hidden={!showTotals} /> : null}
          {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={loading ? <ActivityIndicator color={colors.brandBlue} size="large" /> : reports.length && filtered ? (
        <View style={styles.emptyState}>
          <Text selectable style={styles.emptyTitle}>No matching service reports</Text>
          <Text selectable style={styles.emptyBody}>Try a different search or clear the filters.</Text>
        </View>
      ) : (
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
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  resultLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  billingChip: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: colors.brandBlue, backgroundColor: '#eaf2ff' },
  billingChipText: { color: colors.brandNavy, fontSize: 11, fontWeight: '800' },
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
  total: { color: colors.brandNavy, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
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
