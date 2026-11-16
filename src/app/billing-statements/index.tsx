import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { DateRangeFields } from '@/components/date-range-fields';
import { Dropdown } from '@/components/dropdown';
import { ListEmpty, ListPaneHeader, listRowStyles } from '@/components/list-pane';
import { SplitView, useSplitLayout } from '@/components/split-view';
import { StatusChip, documentStateTone, sentenceCase } from '@/components/status-chip';
import { getLocalBusinessDate } from '@/domain/business-date';
import { formatDisplayDate } from '@/domain/calendar';
import { formatCentavos } from '@/domain/money';
import { BillingStatementDetailView } from '@/features/billing-statements/billing-statement-detail-view';
import { listBillingStatements } from '@/features/billing-statements/billing-statement-repository';
import {
  DEFAULT_STATEMENT_CRITERIA,
  PERIOD_OPTIONS,
  STATEMENT_CSR_OPTIONS,
  STATEMENT_PAYMENT_OPTIONS,
  STATEMENT_SORT_OPTIONS,
  STATEMENT_STATE_OPTIONS,
  activePayments,
  filterBillingStatements,
  hasActiveStatementFilters,
  sumStatementSales,
  type BillingStatementCriteria,
} from '@/features/billing-statements/billing-statement-filter';
import type { BillingStatementListItem } from '@/features/billing-statements/billing-statement-types';
import { colors } from '@/theme/colors';
import { spacing, text } from '@/theme/typography';

type StatementRowProps = {
  statement: BillingStatementListItem;
  showTotal: boolean;
  selected: boolean;
  onOpen: (statementId: string) => void;
};

const StatementRow = memo(function StatementRow({ statement, showTotal, selected, onOpen }: StatementRowProps) {
  const payments = activePayments(statement);
  const serviceReportId = statement.serviceReportId;
  const deliveryId = statement.deliveryId;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onOpen(statement.id)}
      style={({ pressed }) => [listRowStyles.row, selected ? listRowStyles.selected : null, pressed && !selected ? listRowStyles.pressed : null]}
    >
      <View style={listRowStyles.titleLine}>
        <Text style={listRowStyles.number}>{statement.bsNumber ?? 'Draft'}</Text>
        <StatusChip label={sentenceCase(statement.documentState)} tone={documentStateTone(statement.documentState)} />
      </View>
      <Text numberOfLines={1} style={text.bodyStrong}>{statement.customerName}</Text>
      <View style={listRowStyles.metaLine}>
        <Text numberOfLines={1} style={[text.meta, { flex: 1 }]}>
          {formatDisplayDate(statement.businessDate)}{statement.documentState === 'finalized' ? ` · PDF ${statement.pdfState.replaceAll('_', ' ')}` : ''}
        </Text>
        <Text style={text.amount}>{showTotal ? formatCentavos(statement.discountedTotalCentavos) : '₱ ••••••'}</Text>
      </View>
      <View style={styles.links}>
        {serviceReportId ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open linked ${statement.serviceReportNumber ?? 'draft CSR'}`}
            hitSlop={6}
            onPress={() => router.push({ pathname: '/service-reports/[report-id]', params: { 'report-id': serviceReportId } })}
            style={listRowStyles.linkChip}
          >
            <Text style={listRowStyles.linkChipText}>{statement.serviceReportNumber ?? 'Draft CSR'} ›</Text>
          </Pressable>
        ) : null}
        {deliveryId ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open linked ${statement.deliveryNumber ?? 'draft delivery'}`}
            hitSlop={6}
            onPress={() => router.push({ pathname: '/deliveries/[delivery-id]', params: { 'delivery-id': deliveryId } })}
            style={listRowStyles.linkChip}
          >
            <Text style={listRowStyles.linkChipText}>{statement.deliveryNumber ?? 'Draft delivery'} ›</Text>
          </Pressable>
        ) : null}
        {payments.length ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={payments.length === 1 ? `Open ${payments[0].paNumber}` : 'Open this statement to see its payment acknowledgments'}
            hitSlop={6}
            onPress={() => (payments.length === 1
              ? router.push({ pathname: '/payments/[payment-id]', params: { 'payment-id': payments[0].id } })
              : onOpen(statement.id))}
            style={listRowStyles.linkChip}
          >
            <Text style={listRowStyles.linkChipText}>{payments[0].paNumber}{payments.length > 1 ? ` +${payments.length - 1} more` : ''} ›</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
});

export default function BillingStatementsScreen() {
  const db = useSQLiteContext();
  const split = useSplitLayout();
  const [rows, setRows] = useState<BillingStatementListItem[]>([]);
  const [criteria, setCriteria] = useState<BillingStatementCriteria>(DEFAULT_STATEMENT_CRITERIA);
  const [showTotals, setShowTotals] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listBillingStatements(db));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load billing statements.');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const visible = useMemo(() => filterBillingStatements(rows, criteria, getLocalBusinessDate()), [criteria, rows]);
  const filtered = hasActiveStatementFilters(criteria);
  const sales = useMemo(() => sumStatementSales(visible), [visible]);
  const activeFilterCount = [
    criteria.state !== DEFAULT_STATEMENT_CRITERIA.state,
    criteria.csr !== DEFAULT_STATEMENT_CRITERIA.csr,
    criteria.payment !== DEFAULT_STATEMENT_CRITERIA.payment,
    criteria.period !== DEFAULT_STATEMENT_CRITERIA.period,
  ].filter(Boolean).length;
  const update = <K extends keyof BillingStatementCriteria>(key: K, value: BillingStatementCriteria[K]) => setCriteria((current) => ({ ...current, [key]: value }));
  const changePeriod = (period: BillingStatementCriteria['period']) => setCriteria((current) => {
    // Start a custom range on today so both calendars show a real date.
    const today = getLocalBusinessDate();
    return { ...current, period, from: period === 'custom' && !current.from ? today : current.from, to: period === 'custom' && !current.to ? today : current.to };
  });

  const openStatement = useCallback((statementId: string) => {
    if (split) setSelectedId(statementId);
    else router.push({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': statementId } });
  }, [split]);

  const list = (
    <FlatList
      keyboardShouldPersistTaps="handled"
      data={visible}
      extraData={`${showTotals}:${selectedId}:${split}`}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <StatementRow statement={item} showTotal={showTotals} selected={split && item.id === selectedId} onOpen={openStatement} />
      )}
      refreshing={loading && rows.length > 0}
      onRefresh={load}
      ListHeaderComponent={(
        <ListPaneHeader
          title="Billing statements"
          newLabel="New statement draft"
          onNew={() => router.push('/billing-statements/new')}
          query={criteria.query}
          onQueryChange={(value) => update('query', value)}
          searchPlaceholder="BS no., customer, CSR, control no."
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((open) => !open)}
          activeFilterCount={activeFilterCount}
          filters={(
            <>
              <Dropdown label="Status" value={criteria.state} options={STATEMENT_STATE_OPTIONS} onChange={(value) => update('state', value)} />
              <Dropdown label="CSR" value={criteria.csr} options={STATEMENT_CSR_OPTIONS} onChange={(value) => update('csr', value)} />
              <Dropdown label="Payment" value={criteria.payment} options={STATEMENT_PAYMENT_OPTIONS} onChange={(value) => update('payment', value)} />
              <Dropdown label="Date" value={criteria.period} options={PERIOD_OPTIONS} onChange={changePeriod} />
              <Dropdown label="Sort by" value={criteria.sort} options={STATEMENT_SORT_OPTIONS} onChange={(value) => update('sort', value)} />
              {criteria.period === 'custom' ? (
                <DateRangeFields from={criteria.from} to={criteria.to} onChange={(range) => setCriteria((current) => ({ ...current, ...range }))} />
              ) : null}
            </>
          )}
          countLine={`${visible.length} of ${rows.length} billing statement${rows.length === 1 ? '' : 's'}`}
          showTotals={showTotals}
          onToggleTotals={() => setShowTotals((current) => !current)}
          onClearFilters={filtered ? () => setCriteria((current) => ({ ...DEFAULT_STATEMENT_CRITERIA, sort: current.sort })) : undefined}
          sales={filtered ? { totalCentavos: sales.totalCentavos, count: sales.count, noun: 'billing statement' } : undefined}
          error={error}
        />
      )}
      ListEmptyComponent={loading ? <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 32 }} /> : rows.length && filtered ? (
        <ListEmpty title="No matching billing statements" body="Try a different search or clear the filters." />
      ) : (
        <ListEmpty title="No billing statements yet" body="Drafts are unnumbered. Finalizing freezes the charges and deducts stock for direct item sales. Create a draft for a registered customer." />
      )}
    />
  );

  if (!split) return list;

  return (
    <SplitView
      list={list}
      detail={selectedId ? (
        <BillingStatementDetailView
          key={selectedId}
          embedded
          statementId={selectedId}
          onDeleted={() => {
            setSelectedId(null);
            void load();
          }}
        />
      ) : null}
      emptyTitle="Select a billing statement"
      emptyBody="Its charges, payments and actions open here."
    />
  );
}

const styles = StyleSheet.create({
  links: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg },
});
