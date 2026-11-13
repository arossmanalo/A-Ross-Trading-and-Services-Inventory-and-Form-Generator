import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { DateRangeFields } from '@/components/date-range-fields';
import { Dropdown } from '@/components/dropdown';
import { ListEmpty, ListPaneHeader, listRowStyles } from '@/components/list-pane';
import { SplitView, useSplitLayout } from '@/components/split-view';
import { StatusChip, documentStateTone, sentenceCase } from '@/components/status-chip';
import { getLocalBusinessDate } from '@/domain/business-date';
import { formatDisplayDate } from '@/domain/calendar';
import { formatCentavos } from '@/domain/money';
import { ServiceReportDetailView } from '@/features/service-reports/service-report-detail-view';
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
import { text } from '@/theme/typography';

type ReportRowProps = {
  report: ServiceReportSummary;
  showTotal: boolean;
  selected: boolean;
  onOpen: (reportId: string) => void;
};

const ReportRow = memo(function ReportRow({ report, showTotal, selected, onOpen }: ReportRowProps) {
  const billed = report.linkedStatements.filter((statement) => statement.documentState !== 'voided');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onOpen(report.id)}
      style={({ pressed }) => [listRowStyles.row, selected ? listRowStyles.selected : null, pressed && !selected ? listRowStyles.pressed : null]}
    >
      <View style={listRowStyles.titleLine}>
        <Text style={listRowStyles.number}>{report.csrNumber ?? 'Draft'}</Text>
        <StatusChip label={sentenceCase(report.documentState)} tone={documentStateTone(report.documentState)} />
      </View>
      <Text numberOfLines={1} style={text.bodyStrong}>{report.customerName}</Text>
      <View style={listRowStyles.metaLine}>
        <Text numberOfLines={1} style={[text.meta, { flex: 1 }]}>
          {report.equipmentName} · {formatDisplayDate(report.businessDate)} · {sentenceCase(report.serviceOutcome)}
        </Text>
        <Text style={text.amount}>{showTotal ? formatCentavos(report.totalBillCentavos) : '₱ ••••••'}</Text>
      </View>
      {report.documentState === 'finalized' ? <Text style={text.meta}>PDF {report.pdfState.replaceAll('_', ' ')}</Text> : null}
      {billed.length ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={billed.length === 1 ? `Open ${billed[0].bsNumber ?? 'draft Billing Statement'}` : 'Open this CSR to see its Billing Statements'}
          hitSlop={6}
          onPress={() => (billed.length === 1
            ? router.push({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': billed[0].id } })
            : onOpen(report.id))}
          style={listRowStyles.linkChip}
        >
          <Text style={listRowStyles.linkChipText}>
            {billed[0].bsNumber ?? 'Draft statement'}{billed.length > 1 ? ` +${billed.length - 1} more` : ''} ›
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
});

export default function ServiceReportsScreen() {
  const db = useSQLiteContext();
  const split = useSplitLayout();
  const [reports, setReports] = useState<ServiceReportListItem[]>([]);
  const [criteria, setCriteria] = useState<ServiceReportCriteria>(DEFAULT_CRITERIA);
  const [showTotals, setShowTotals] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const activeFilterCount = [criteria.state !== 'all', criteria.outcome !== 'all', criteria.billing !== 'any', criteria.period !== 'all'].filter(Boolean).length;
  const update = <K extends keyof ServiceReportCriteria>(key: K, value: ServiceReportCriteria[K]) => setCriteria((current) => ({ ...current, [key]: value }));

  const changePeriod = (period: ServiceReportCriteria['period']) => setCriteria((current) => {
    // Start a custom range on today so both calendars show a real date.
    const today = getLocalBusinessDate();
    return { ...current, period, from: period === 'custom' && !current.from ? today : current.from, to: period === 'custom' && !current.to ? today : current.to };
  });

  const openReport = useCallback((reportId: string) => {
    if (split) setSelectedId(reportId);
    else router.push({ pathname: '/service-reports/[report-id]', params: { 'report-id': reportId } });
  }, [split]);

  const list = (
    <FlatList
      keyboardShouldPersistTaps="handled"
      data={visible}
      keyExtractor={(report) => report.id}
      extraData={`${showTotals}:${selectedId}:${split}`}
      renderItem={({ item }) => (
        <ReportRow report={item} showTotal={showTotals} selected={split && item.id === selectedId} onOpen={openReport} />
      )}
      refreshing={loading && reports.length > 0}
      onRefresh={loadReports}
      ListHeaderComponent={(
        <ListPaneHeader
          newLabel="New CSR draft"
          onNew={() => router.push('/service-reports/new')}
          query={criteria.query}
          onQueryChange={(value) => update('query', value)}
          searchPlaceholder="CSR, customer, machine, serial, control no., BS no."
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((open) => !open)}
          activeFilterCount={activeFilterCount}
          filters={(
            <>
              <Dropdown label="Status" value={criteria.state} options={STATE_OPTIONS} onChange={(value) => update('state', value)} />
              <Dropdown label="Outcome" value={criteria.outcome} options={OUTCOME_OPTIONS} onChange={(value) => update('outcome', value)} />
              <Dropdown label="Billing" value={criteria.billing} options={BILLING_OPTIONS} onChange={(value) => update('billing', value)} />
              <Dropdown label="Date" value={criteria.period} options={PERIOD_OPTIONS} onChange={changePeriod} />
              <Dropdown label="Sort by" value={criteria.sort} options={SORT_OPTIONS} onChange={(value) => update('sort', value)} />
              {criteria.period === 'custom' ? (
                <DateRangeFields from={criteria.from} to={criteria.to} onChange={(range) => setCriteria((current) => ({ ...current, ...range }))} />
              ) : null}
            </>
          )}
          countLine={`${visible.length} of ${reports.length} service report${reports.length === 1 ? '' : 's'}`}
          showTotals={showTotals}
          onToggleTotals={() => setShowTotals((current) => !current)}
          onClearFilters={filtered ? () => setCriteria((current) => ({ ...DEFAULT_CRITERIA, sort: current.sort })) : undefined}
          sales={filtered ? { totalCentavos: sales.totalCentavos, count: sales.count, noun: 'service report' } : undefined}
          error={error}
        />
      )}
      ListEmptyComponent={loading ? <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 32 }} /> : reports.length && filtered ? (
        <ListEmpty title="No matching service reports" body="Try a different search or clear the filters." />
      ) : (
        <ListEmpty title="No service reports yet" body="Create the first unnumbered draft for a registered customer and equipment record." />
      )}
    />
  );

  if (!split) return list;

  return (
    <SplitView
      list={list}
      detail={selectedId ? (
        <ServiceReportDetailView
          key={selectedId}
          embedded
          reportId={selectedId}
          onDeleted={() => {
            setSelectedId(null);
            void loadReports();
          }}
          onChanged={() => void loadReports()}
        />
      ) : null}
      emptyTitle="Select a service report"
      emptyBody="Its details, items and actions open here. Use New CSR draft to start a visit."
    />
  );
}
