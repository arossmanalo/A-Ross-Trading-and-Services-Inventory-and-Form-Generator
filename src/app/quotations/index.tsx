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
import { isQuotationExpired } from '@/domain/quotation';
import {
  DEFAULT_QUOTATION_CRITERIA,
  PERIOD_OPTIONS,
  QUOTATION_CONVERSION_OPTIONS,
  QUOTATION_SORT_OPTIONS,
  QUOTATION_STATE_OPTIONS,
  filterQuotations,
  hasActiveQuotationFilters,
  sumQuotationTotals,
  type QuotationCriteria,
} from '@/features/quotations/quotation-filter';
import { listQuotations } from '@/features/quotations/quotation-repository';
import type { QuotationListItem } from '@/features/quotations/quotation-types';
import { colors } from '@/theme/colors';

const QuotationRow = memo(function QuotationRow({ quotation, showTotal, today }: { quotation: QuotationListItem; showTotal: boolean; today: string }) {
  const open = useCallback(() => {
    router.push({ pathname: '/quotations/[quotation-id]', params: { 'quotation-id': quotation.id } });
  }, [quotation.id]);
  const expired = quotation.documentState === 'finalized' && !quotation.convertedKind && isQuotationExpired(quotation.validUntil, today);
  return (
    <Pressable accessibilityRole="button" onPress={open} style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>
      <View style={styles.rowCopy}>
        <View style={styles.titleLine}>
          <Text selectable style={styles.number}>{quotation.qtNumber ?? 'DRAFT'}</Text>
          <Text selectable style={quotation.documentState === 'draft' ? styles.draftBadge : quotation.documentState === 'voided' ? styles.voidBadge : styles.finalBadge}>
            {quotation.documentState.toUpperCase()}
          </Text>
          {expired ? <Text selectable style={styles.voidBadge}>EXPIRED</Text> : null}
        </View>
        <Text selectable style={styles.customer}>{quotation.customerName}</Text>
        <Text selectable style={styles.meta}>{quotation.businessDate} · valid until {quotation.validUntil}</Text>
        {quotation.convertedKind ? (
          <View style={styles.convertedChip}>
            <Text style={styles.convertedChipText}>Converted · {quotation.convertedKind === 'repair' ? 'Repair (CSR)' : 'Delivery'}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.stateCopy}>
        <Text selectable style={styles.total}>{showTotal ? formatCentavos(quotation.totalCentavos) : '₱ ••••••'}</Text>
        {quotation.documentState === 'finalized' ? <Text selectable style={styles.pdf}>PDF {quotation.pdfState}</Text> : null}
      </View>
    </Pressable>
  );
});

export default function QuotationsScreen() {
  const db = useSQLiteContext();
  const [rows, setRows] = useState<QuotationListItem[]>([]);
  const [criteria, setCriteria] = useState<QuotationCriteria>(DEFAULT_QUOTATION_CRITERIA);
  const [showTotals, setShowTotals] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listQuotations(db));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load quotations.');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const today = getLocalBusinessDate();
  const visible = useMemo(() => filterQuotations(rows, criteria, today), [criteria, rows, today]);
  const filtered = hasActiveQuotationFilters(criteria);
  const totals = useMemo(() => sumQuotationTotals(visible), [visible]);
  const update = <K extends keyof QuotationCriteria>(key: K, value: QuotationCriteria[K]) => setCriteria((current) => ({ ...current, [key]: value }));
  const changePeriod = (period: QuotationCriteria['period']) => setCriteria((current) => ({
    ...current,
    period,
    // Start a custom range on today so both calendars show a real date.
    from: period === 'custom' && !current.from ? today : current.from,
    to: period === 'custom' && !current.to ? today : current.to,
  }));

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={visible.length ? styles.content : styles.emptyContent}
      data={visible}
      extraData={showTotals}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <QuotationRow quotation={item} showTotal={showTotals} today={today} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      refreshing={loading && rows.length > 0}
      onRefresh={load}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text selectable style={styles.eyebrow}>QUOTATIONS</Text>
          <Text selectable style={styles.help}>A quotation lists the items and services you are offering and a valid-until date. A finalized one can become a repair (CSR) or a delivery, each with its Billing Statement.</Text>
          <Link href="/quotations/new" asChild>
            <Pressable accessibilityRole="button" style={styles.newButton}>
              <Text selectable style={styles.newText}>New quotation draft</Text>
            </Pressable>
          </Link>
          <FormField
            autoCapitalize="none"
            autoCorrect={false}
            label="Search"
            onChangeText={(value) => update('query', value)}
            placeholder="QT number, customer, item or service, date, amount…"
            returnKeyType="search"
            value={criteria.query}
          />
          <View style={styles.filters}>
            <Dropdown label="STATUS" value={criteria.state} options={QUOTATION_STATE_OPTIONS} onChange={(value) => update('state', value)} />
            <Dropdown label="CONVERSION" value={criteria.conversion} options={QUOTATION_CONVERSION_OPTIONS} onChange={(value) => update('conversion', value)} />
            <Dropdown label="DATE" value={criteria.period} options={PERIOD_OPTIONS} onChange={changePeriod} />
            <Dropdown label="SORT BY" value={criteria.sort} options={QUOTATION_SORT_OPTIONS} onChange={(value) => update('sort', value)} />
          </View>
          {criteria.period === 'custom' ? <DateRangeFields from={criteria.from} to={criteria.to} onChange={(range) => setCriteria((current) => ({ ...current, ...range }))} /> : null}
          <View style={styles.resultLine}>
            <Text selectable style={styles.help}>{visible.length} of {rows.length} quotation{rows.length === 1 ? '' : 's'}</Text>
            <ActionButton compact variant="secondary" onPress={() => setShowTotals((current) => !current)}>{showTotals ? 'Hide totals' : 'Show totals'}</ActionButton>
            {filtered ? <ActionButton compact variant="secondary" onPress={() => setCriteria((current) => ({ ...DEFAULT_QUOTATION_CRITERIA, sort: current.sort }))}>Clear filters</ActionButton> : null}
          </View>
          {filtered ? <SalesTotalCard totalCentavos={totals.totalCentavos} count={totals.count} noun="quotation" hidden={!showTotals} /> : null}
          {error ? <Text selectable style={styles.error}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={loading ? <ActivityIndicator color={colors.brandBlue} size="large" /> : rows.length && filtered ? (
        <View style={styles.empty}>
          <Text selectable style={styles.emptyTitle}>No matching quotations</Text>
          <Text selectable style={styles.help}>Try a different search or clear the filters.</Text>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text selectable style={styles.emptyTitle}>No quotations yet</Text>
          <Text selectable style={styles.help}>Create a draft for a registered customer.</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  resultLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  convertedChip: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: colors.success, backgroundColor: '#e8f7ee' },
  convertedChipText: { color: colors.success, fontSize: 11, fontWeight: '800' },
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
  stateCopy: { maxWidth: 150, alignItems: 'flex-end', gap: 4 },
  pdf: { color: colors.secondaryLabel, fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 28 },
  emptyTitle: { color: colors.label, fontSize: 20, fontWeight: '900' },
  error: { color: colors.error, fontSize: 13 },
  pressed: { opacity: 0.72 },
});
