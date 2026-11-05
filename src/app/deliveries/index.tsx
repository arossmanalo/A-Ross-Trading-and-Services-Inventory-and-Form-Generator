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
  DEFAULT_DELIVERY_CRITERIA,
  DELIVERY_BILLING_OPTIONS,
  DELIVERY_SORT_OPTIONS,
  DELIVERY_STATE_OPTIONS,
  PERIOD_OPTIONS,
  filterDeliveries,
  hasActiveDeliveryFilters,
  sumDeliveryValue,
  type DeliveryCriteria,
} from '@/features/deliveries/delivery-filter';
import { listDeliveries } from '@/features/deliveries/delivery-repository';
import type { DeliveryListItem } from '@/features/deliveries/delivery-types';
import { colors } from '@/theme/colors';

const DeliveryRow = memo(function DeliveryRow({ delivery, showTotal }: { delivery: DeliveryListItem; showTotal: boolean }) {
  const open = useCallback(() => {
    router.push({ pathname: '/deliveries/[delivery-id]', params: { 'delivery-id': delivery.id } });
  }, [delivery.id]);
  return (
    <Pressable accessibilityRole="button" onPress={open} style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>
      <View style={styles.rowCopy}>
        <View style={styles.titleLine}>
          <Text selectable style={styles.number}>{delivery.dfNumber ?? 'DRAFT'}</Text>
          <Text selectable style={delivery.documentState === 'draft' ? styles.draftBadge : delivery.documentState === 'voided' ? styles.voidBadge : styles.finalBadge}>
            {delivery.documentState.toUpperCase()}
          </Text>
        </View>
        <Text selectable style={styles.customer}>{delivery.customerName}</Text>
        <Text selectable style={styles.meta}>{delivery.businessDate}</Text>
        {delivery.linkedStatements.length ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${delivery.linkedStatements[0].bsNumber ?? 'draft Billing Statement'}`}
            hitSlop={6}
            onPress={() => router.push({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': delivery.linkedStatements[0].id } })}
            style={styles.billingChip}
          >
            <Text style={styles.billingChipText}>{delivery.linkedStatements[0].bsNumber ?? 'Draft statement'} ›</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.stateCopy}>
        <Text selectable style={styles.total}>{showTotal ? formatCentavos(delivery.totalCentavos) : '₱ ••••••'}</Text>
        {delivery.documentState === 'finalized' ? <Text selectable style={styles.pdf}>PDF {delivery.pdfState}</Text> : null}
      </View>
    </Pressable>
  );
});

export default function DeliveriesScreen() {
  const db = useSQLiteContext();
  const [rows, setRows] = useState<DeliveryListItem[]>([]);
  const [criteria, setCriteria] = useState<DeliveryCriteria>(DEFAULT_DELIVERY_CRITERIA);
  const [showTotals, setShowTotals] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listDeliveries(db));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load deliveries.');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const today = getLocalBusinessDate();
  const visible = useMemo(() => filterDeliveries(rows, criteria, today), [criteria, rows, today]);
  const filtered = hasActiveDeliveryFilters(criteria);
  const totals = useMemo(() => sumDeliveryValue(visible), [visible]);
  const update = <K extends keyof DeliveryCriteria>(key: K, value: DeliveryCriteria[K]) => setCriteria((current) => ({ ...current, [key]: value }));
  const changePeriod = (period: DeliveryCriteria['period']) => setCriteria((current) => ({
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
      renderItem={({ item }) => <DeliveryRow delivery={item} showTotal={showTotals} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      refreshing={loading && rows.length > 0}
      onRefresh={load}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text selectable style={styles.eyebrow}>DELIVERY FORMS</Text>
          <Text selectable style={styles.help}>Deliveries list inventory items. Finalizing one deducts the delivered quantities from stock, and its Billing Statement bills what was delivered.</Text>
          <Link href="/deliveries/new" asChild>
            <Pressable accessibilityRole="button" style={styles.newButton}>
              <Text selectable style={styles.newText}>New delivery draft</Text>
            </Pressable>
          </Link>
          <FormField
            autoCapitalize="none"
            autoCorrect={false}
            label="Search"
            onChangeText={(value) => update('query', value)}
            placeholder="DF number, customer, item, date, amount…"
            returnKeyType="search"
            value={criteria.query}
          />
          <View style={styles.filters}>
            <Dropdown label="STATUS" value={criteria.state} options={DELIVERY_STATE_OPTIONS} onChange={(value) => update('state', value)} />
            <Dropdown label="BILLING" value={criteria.billing} options={DELIVERY_BILLING_OPTIONS} onChange={(value) => update('billing', value)} />
            <Dropdown label="DATE" value={criteria.period} options={PERIOD_OPTIONS} onChange={changePeriod} />
            <Dropdown label="SORT BY" value={criteria.sort} options={DELIVERY_SORT_OPTIONS} onChange={(value) => update('sort', value)} />
          </View>
          {criteria.period === 'custom' ? <DateRangeFields from={criteria.from} to={criteria.to} onChange={(range) => setCriteria((current) => ({ ...current, ...range }))} /> : null}
          <View style={styles.resultLine}>
            <Text selectable style={styles.help}>{visible.length} of {rows.length} deliver{rows.length === 1 ? 'y' : 'ies'}</Text>
            <ActionButton compact variant="secondary" onPress={() => setShowTotals((current) => !current)}>{showTotals ? 'Hide totals' : 'Show totals'}</ActionButton>
            {filtered ? <ActionButton compact variant="secondary" onPress={() => setCriteria((current) => ({ ...DEFAULT_DELIVERY_CRITERIA, sort: current.sort }))}>Clear filters</ActionButton> : null}
          </View>
          {filtered ? <SalesTotalCard totalCentavos={totals.totalCentavos} count={totals.count} noun="delivery" hidden={!showTotals} /> : null}
          {error ? <Text selectable style={styles.error}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={loading ? <ActivityIndicator color={colors.brandBlue} size="large" /> : rows.length && filtered ? (
        <View style={styles.empty}>
          <Text selectable style={styles.emptyTitle}>No matching deliveries</Text>
          <Text selectable style={styles.help}>Try a different search or clear the filters.</Text>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text selectable style={styles.emptyTitle}>No deliveries yet</Text>
          <Text selectable style={styles.help}>Create a draft for a registered customer.</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  resultLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  billingChip: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: colors.brandBlue, backgroundColor: '#eaf2ff' },
  billingChipText: { color: colors.brandNavy, fontSize: 11, fontWeight: '800' },
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
