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

const StatementRow = memo(function StatementRow({ statement, showTotal }: { statement: BillingStatementListItem; showTotal: boolean }) {
  const open = useCallback(() => {
    router.push({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': statement.id } });
  }, [statement.id]);
  const payments = activePayments(statement);
  return (
    <Pressable accessibilityRole="button" onPress={open} style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>
      <View style={styles.rowCopy}>
        <View style={styles.titleLine}>
          <Text selectable style={styles.number}>{statement.bsNumber ?? 'DRAFT'}</Text>
          <Text selectable style={statement.documentState === 'draft' ? styles.draftBadge : statement.documentState === 'voided' ? styles.voidBadge : styles.finalBadge}>
            {statement.documentState.toUpperCase()}
          </Text>
        </View>
        <Text selectable style={styles.customer}>{statement.customerName}</Text>
        <Text selectable style={styles.meta}>{statement.businessDate}</Text>
        <View style={styles.chips}>
          {statement.serviceReportId ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Open linked ${statement.serviceReportNumber ?? 'draft CSR'}`}
              hitSlop={6}
              onPress={() => router.push({ pathname: '/service-reports/[report-id]', params: { 'report-id': statement.serviceReportId! } })}
              style={styles.csrChip}
            >
              <Text style={styles.csrChipText}>{statement.serviceReportNumber ?? 'Draft CSR'} ›</Text>
            </Pressable>
          ) : null}
          {payments.length ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={payments.length === 1 ? `Open ${payments[0].paNumber}` : 'Open this statement to see its payment acknowledgments'}
              hitSlop={6}
              onPress={() => (payments.length === 1
                ? router.push({ pathname: '/payments/[payment-id]', params: { 'payment-id': payments[0].id } })
                : open())}
              style={styles.paymentChip}
            >
              <Text style={styles.paymentChipText}>{payments[0].paNumber}{payments.length > 1 ? ` +${payments.length - 1} more` : ''} ›</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={styles.stateCopy}>
        <Text selectable style={styles.total}>{showTotal ? formatCentavos(statement.discountedTotalCentavos) : '₱ ••••••'}</Text>
        {statement.documentState === 'finalized' ? <Text selectable style={styles.pdf}>PDF {statement.pdfState}</Text> : null}
      </View>
    </Pressable>
  );
});

export default function BillingStatementsScreen() {
  const db = useSQLiteContext();
  const [rows, setRows] = useState<BillingStatementListItem[]>([]);
  const [criteria, setCriteria] = useState<BillingStatementCriteria>(DEFAULT_STATEMENT_CRITERIA);
  const [showTotals, setShowTotals] = useState(true);
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
  const update = <K extends keyof BillingStatementCriteria>(key: K, value: BillingStatementCriteria[K]) => setCriteria((current) => ({ ...current, [key]: value }));
  const changePeriod = (period: BillingStatementCriteria['period']) => setCriteria((current) => {
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
      extraData={showTotals}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <StatementRow statement={item} showTotal={showTotals} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      refreshing={loading && rows.length > 0}
      onRefresh={load}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text selectable style={styles.eyebrow}>BILLING STATEMENTS</Text>
          <Text selectable style={styles.help}>Drafts are unnumbered. Finalization freezes charges and deducts stock for direct item sales.</Text>
          <Link href="/billing-statements/new" asChild>
            <Pressable accessibilityRole="button" style={styles.newButton}>
              <Text selectable style={styles.newText}>New statement draft</Text>
            </Pressable>
          </Link>
          <FormField
            autoCapitalize="none"
            autoCorrect={false}
            label="Search"
            onChangeText={(value) => update('query', value)}
            placeholder="BS number, customer, CSR or PA number, date, amount…"
            returnKeyType="search"
            value={criteria.query}
          />
          <View style={styles.filters}>
            <Dropdown label="STATUS" value={criteria.state} options={STATEMENT_STATE_OPTIONS} onChange={(value) => update('state', value)} />
            <Dropdown label="CSR" value={criteria.csr} options={STATEMENT_CSR_OPTIONS} onChange={(value) => update('csr', value)} />
            <Dropdown label="PAYMENT" value={criteria.payment} options={STATEMENT_PAYMENT_OPTIONS} onChange={(value) => update('payment', value)} />
            <Dropdown label="DATE" value={criteria.period} options={PERIOD_OPTIONS} onChange={changePeriod} />
            <Dropdown label="SORT BY" value={criteria.sort} options={STATEMENT_SORT_OPTIONS} onChange={(value) => update('sort', value)} />
          </View>
          {criteria.period === 'custom' ? <DateRangeFields from={criteria.from} to={criteria.to} onChange={(range) => setCriteria((current) => ({ ...current, ...range }))} /> : null}
          <View style={styles.resultLine}>
            <Text selectable style={styles.help}>{visible.length} of {rows.length} billing statement{rows.length === 1 ? '' : 's'}</Text>
            <ActionButton compact variant="secondary" onPress={() => setShowTotals((current) => !current)}>{showTotals ? 'Hide totals' : 'Show totals'}</ActionButton>
            {filtered ? <ActionButton compact variant="secondary" onPress={() => setCriteria((current) => ({ ...DEFAULT_STATEMENT_CRITERIA, sort: current.sort }))}>Clear filters</ActionButton> : null}
          </View>
          {filtered ? <SalesTotalCard totalCentavos={sales.totalCentavos} count={sales.count} noun="billing statement" hidden={!showTotals} /> : null}
          {error ? <Text selectable style={styles.error}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={loading ? <ActivityIndicator color={colors.brandBlue} size="large" /> : rows.length && filtered ? (
        <View style={styles.empty}>
          <Text selectable style={styles.emptyTitle}>No matching billing statements</Text>
          <Text selectable style={styles.help}>Try a different search or clear the filters.</Text>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text selectable style={styles.emptyTitle}>No billing statements yet</Text>
          <Text selectable style={styles.help}>Create a draft for a registered customer.</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  resultLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  csrChip: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: colors.brandBlue, backgroundColor: '#eaf2ff' },
  csrChipText: { color: colors.brandNavy, fontSize: 11, fontWeight: '800' },
  paymentChip: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: colors.success, backgroundColor: '#e8f7ee' },
  paymentChipText: { color: colors.success, fontSize: 11, fontWeight: '800' },
  content: { paddingHorizontal: 18, paddingBottom: 44 },
  emptyContent: { flexGrow: 1, paddingHorizontal: 18, paddingBottom: 44 },
  header: { gap: 10, paddingVertical: 18 },
  eyebrow: { color: colors.brandBlue, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  help: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 19 },
  newButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandBlue, borderRadius: 14, borderCurve: 'continuous' },
  newText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  row: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  rowCopy: { flex: 1, gap: 4 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  number: { color: colors.label, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  total: { color: colors.brandNavy, fontSize: 14, fontWeight: '900', textAlign: 'right', fontVariant: ['tabular-nums'] },
  customer: { color: colors.label, fontSize: 15, fontWeight: '700' },
  meta: { color: colors.secondaryLabel, fontSize: 12 },
  draftBadge: { color: colors.warning, fontSize: 8, fontWeight: '900' },
  finalBadge: { color: colors.success, fontSize: 8, fontWeight: '900' },
  voidBadge: { color: colors.error, fontSize: 8, fontWeight: '900' },
  stateCopy: { alignItems: 'flex-end', gap: 4 },
  pdf: { color: colors.secondaryLabel, fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 28 },
  emptyTitle: { color: colors.label, fontSize: 20, fontWeight: '900' },
  error: { color: colors.error, fontSize: 13 },
  pressed: { opacity: 0.72 },
});
