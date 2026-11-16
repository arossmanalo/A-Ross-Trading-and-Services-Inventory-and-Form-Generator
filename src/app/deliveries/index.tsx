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
import { DeliveryDetailView } from '@/features/deliveries/delivery-detail-view';
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
import { text } from '@/theme/typography';

type DeliveryRowProps = {
  delivery: DeliveryListItem;
  showTotal: boolean;
  selected: boolean;
  onOpen: (deliveryId: string) => void;
};

const DeliveryRow = memo(function DeliveryRow({ delivery, showTotal, selected, onOpen }: DeliveryRowProps) {
  const statement = delivery.linkedStatements[0];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onOpen(delivery.id)}
      style={({ pressed }) => [listRowStyles.row, selected ? listRowStyles.selected : null, pressed && !selected ? listRowStyles.pressed : null]}
    >
      <View style={listRowStyles.titleLine}>
        <Text style={listRowStyles.number}>{delivery.dfNumber ?? 'Draft'}</Text>
        <StatusChip label={sentenceCase(delivery.documentState)} tone={documentStateTone(delivery.documentState)} />
      </View>
      <Text numberOfLines={1} style={text.bodyStrong}>{delivery.customerName}</Text>
      <View style={listRowStyles.metaLine}>
        <Text numberOfLines={1} style={[text.meta, { flex: 1 }]}>
          {formatDisplayDate(delivery.businessDate)}{delivery.documentState === 'finalized' ? ` · PDF ${delivery.pdfState.replaceAll('_', ' ')}` : ''}
        </Text>
        <Text style={text.amount}>{showTotal ? formatCentavos(delivery.totalCentavos) : '₱ ••••••'}</Text>
      </View>
      {statement ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open ${statement.bsNumber ?? 'draft Billing Statement'}`}
          hitSlop={6}
          onPress={() => router.push({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': statement.id } })}
          style={listRowStyles.linkChip}
        >
          <Text style={listRowStyles.linkChipText}>{statement.bsNumber ?? 'Draft statement'} ›</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
});

export default function DeliveriesScreen() {
  const db = useSQLiteContext();
  const split = useSplitLayout();
  const [rows, setRows] = useState<DeliveryListItem[]>([]);
  const [criteria, setCriteria] = useState<DeliveryCriteria>(DEFAULT_DELIVERY_CRITERIA);
  const [showTotals, setShowTotals] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const activeFilterCount = [criteria.state !== DEFAULT_DELIVERY_CRITERIA.state, criteria.billing !== DEFAULT_DELIVERY_CRITERIA.billing, criteria.period !== DEFAULT_DELIVERY_CRITERIA.period].filter(Boolean).length;
  const update = <K extends keyof DeliveryCriteria>(key: K, value: DeliveryCriteria[K]) => setCriteria((current) => ({ ...current, [key]: value }));
  const changePeriod = (period: DeliveryCriteria['period']) => setCriteria((current) => ({
    ...current,
    period,
    // Start a custom range on today so both calendars show a real date.
    from: period === 'custom' && !current.from ? today : current.from,
    to: period === 'custom' && !current.to ? today : current.to,
  }));

  const openDelivery = useCallback((deliveryId: string) => {
    if (split) setSelectedId(deliveryId);
    else router.push({ pathname: '/deliveries/[delivery-id]', params: { 'delivery-id': deliveryId } });
  }, [split]);

  const list = (
    <FlatList
      keyboardShouldPersistTaps="handled"
      data={visible}
      extraData={`${showTotals}:${selectedId}:${split}`}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <DeliveryRow delivery={item} showTotal={showTotals} selected={split && item.id === selectedId} onOpen={openDelivery} />
      )}
      refreshing={loading && rows.length > 0}
      onRefresh={load}
      ListHeaderComponent={(
        <ListPaneHeader
          title="Deliveries"
          newLabel="New delivery draft"
          onNew={() => router.push('/deliveries/new')}
          query={criteria.query}
          onQueryChange={(value) => update('query', value)}
          searchPlaceholder="DF no., customer, item, date"
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((open) => !open)}
          activeFilterCount={activeFilterCount}
          filters={(
            <>
              <Dropdown label="Status" value={criteria.state} options={DELIVERY_STATE_OPTIONS} onChange={(value) => update('state', value)} />
              <Dropdown label="Billing" value={criteria.billing} options={DELIVERY_BILLING_OPTIONS} onChange={(value) => update('billing', value)} />
              <Dropdown label="Date" value={criteria.period} options={PERIOD_OPTIONS} onChange={changePeriod} />
              <Dropdown label="Sort by" value={criteria.sort} options={DELIVERY_SORT_OPTIONS} onChange={(value) => update('sort', value)} />
              {criteria.period === 'custom' ? (
                <DateRangeFields from={criteria.from} to={criteria.to} onChange={(range) => setCriteria((current) => ({ ...current, ...range }))} />
              ) : null}
            </>
          )}
          countLine={`${visible.length} of ${rows.length} deliver${rows.length === 1 ? 'y' : 'ies'}`}
          showTotals={showTotals}
          onToggleTotals={() => setShowTotals((current) => !current)}
          onClearFilters={filtered ? () => setCriteria((current) => ({ ...DEFAULT_DELIVERY_CRITERIA, sort: current.sort })) : undefined}
          sales={filtered ? { totalCentavos: totals.totalCentavos, count: totals.count, noun: 'delivery', nounPlural: 'deliveries' } : undefined}
          error={error}
        />
      )}
      ListEmptyComponent={loading ? <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 32 }} /> : rows.length && filtered ? (
        <ListEmpty title="No matching deliveries" body="Try a different search or clear the filters." />
      ) : (
        <ListEmpty title="No deliveries yet" body="Deliveries list inventory items. Finalizing one deducts the delivered quantities from stock. Create a draft for a registered customer." />
      )}
    />
  );

  if (!split) return list;

  return (
    <SplitView
      list={list}
      detail={selectedId ? (
        <DeliveryDetailView
          key={selectedId}
          embedded
          deliveryId={selectedId}
          onDeleted={() => {
            setSelectedId(null);
            void load();
          }}
          onChanged={() => void load()}
        />
      ) : null}
      emptyTitle="Select a delivery"
      emptyBody="Its items, value and actions open here."
    />
  );
}
