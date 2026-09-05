import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { getLocalBusinessDate } from '@/domain/business-date';
import { listInventoryItems } from '@/features/inventory/inventory-repository';
import type { InventoryItemSummary } from '@/features/inventory/inventory-types';
import {
  filterMovementReport,
  getInventoryMovementReport,
  movementReportCsv,
  movementTypeLabel,
  type InventoryMovementReportRow,
  type MovementTypeFilter,
} from '@/features/reports/inventory-report';
import { shareCsvReport } from '@/features/reports/report-export';
import { colors } from '@/theme/colors';

const MOVEMENT_FILTERS: MovementTypeFilter[] = ['all', 'restock', 'sale', 'nonbillable_usage', 'consumption', 'reversal'];

export default function MovementReportScreen() {
  const db = useSQLiteContext();
  const today = getLocalBusinessDate();
  const [from, setFrom] = useState(today.slice(0, 7) + '-01');
  const [to, setTo] = useState(today);
  const [items, setItems] = useState<InventoryItemSummary[]>([]);
  const [itemId, setItemId] = useState('');
  const [itemQuery, setItemQuery] = useState('');
  const [movementType, setMovementType] = useState<MovementTypeFilter>('all');
  const [rows, setRows] = useState<InventoryMovementReportRow[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedItem = items.find(item => item.id === itemId);
  const visibleRows = useMemo(() => filterMovementReport(rows, query), [rows, query]);
  const netQuantity = visibleRows.reduce((sum, row) => sum + row.quantityDelta, 0);
  const outgoingQuantity = visibleRows.reduce((sum, row) => sum + (row.quantityDelta < 0 ? Math.abs(row.quantityDelta) : 0), 0);
  const incomingQuantity = visibleRows.reduce((sum, row) => sum + (row.quantityDelta > 0 ? row.quantityDelta : 0), 0);

  useFocusEffect(useCallback(() => {
    let active = true;
    setError(null);
    void listInventoryItems(db)
      .then(nextItems => {
        if (active) setItems(nextItems);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not load inventory items.');
      });
    return () => {
      active = false;
    };
  }, [db]));

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setRows(await getInventoryMovementReport(db, { from, to, itemId, movementType }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load movement report.');
    } finally {
      setBusy(false);
    }
  }, [db, from, itemId, movementType, to]);

  const matchingItems = itemQuery.trim()
    ? items.filter(item => [item.name, item.sku ?? '', item.unitLabel].some(value => value.toLowerCase().includes(itemQuery.trim().toLowerCase()))).slice(0, 12)
    : [];

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: 44 }}
      data={visibleRows}
      keyExtractor={row => row.id}
      refreshing={busy}
      onRefresh={() => void generate()}
      ListHeaderComponent={(
        <View style={{ gap: 14, marginBottom: 16 }}>
          <Text selectable>
            Movement reports use the actual recorded movement timestamp and include restocks, sales,
            non-billable use, manual consumption, and reversals.
          </Text>
          <FormField label="From (YYYY-MM-DD)" value={from} onChangeText={setFrom} editable={!busy} />
          <FormField label="To (YYYY-MM-DD)" value={to} onChangeText={setTo} editable={!busy} />
          <FormField label="Find item for report scope" value={itemQuery} onChangeText={setItemQuery} editable={!busy} />
          <ActionButton variant={itemId ? 'secondary' : 'primary'} disabled={busy} onPress={() => setItemId('')}>All items</ActionButton>
          <Text selectable>Selected item: {selectedItem?.name ?? 'All items'}</Text>
          {matchingItems.map(item => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                setItemId(item.id);
                setItemQuery('');
              }}
              style={{ padding: 14, backgroundColor: colors.surface, borderRadius: 10 }}
            >
              <Text selectable style={{ color: colors.label, fontWeight: '700' }}>{item.name}</Text>
              <Text selectable style={{ color: colors.secondaryLabel }}>{item.sku ?? 'No SKU'} - {item.unitLabel}</Text>
            </Pressable>
          ))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {MOVEMENT_FILTERS.map(value => (
              <ActionButton
                key={value}
                compact
                variant={movementType === value ? 'primary' : 'secondary'}
                disabled={busy}
                onPress={() => setMovementType(value)}
              >
                {value === 'all' ? 'All' : movementTypeLabel(value)}
              </ActionButton>
            ))}
          </View>
          <ActionButton disabled={busy} onPress={() => void generate()}>{busy ? 'Working...' : 'Generate movement report'}</ActionButton>
          <FormField label="Search loaded rows" value={query} onChangeText={setQuery} editable={!busy} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <SummaryCard label="Rows" value={visibleRows.length} />
            <SummaryCard label="Incoming" value={incomingQuantity} />
            <SummaryCard label="Outgoing" value={outgoingQuantity} />
            <SummaryCard label="Net" value={netQuantity} />
          </View>
          <ActionButton
            variant="secondary"
            disabled={busy || exporting || visibleRows.length === 0}
            onPress={() => {
              setExporting(true);
              setError(null);
              void shareCsvReport(movementReportCsv(visibleRows), 'inventory-movements')
                .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Export failed.'))
                .finally(() => setExporting(false));
            }}
          >
            {exporting ? 'Exporting...' : 'Share filtered movements as CSV'}
          </ActionButton>
          {error ? <Text selectable style={{ color: colors.error }}>{error}</Text> : null}
        </View>
      )}
      ListEmptyComponent={<Text selectable>{busy ? 'Loading...' : 'No movements match these filters.'}</Text>}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/inventory/item/[item-id]', params: { 'item-id': item.itemId } })}
          style={{ padding: 16, gap: 6, borderRadius: 12, backgroundColor: colors.surface }}
        >
          <Text selectable style={{ color: colors.label, fontWeight: '800' }}>{item.itemName}</Text>
          <Text selectable style={{ color: item.quantityDelta < 0 ? colors.error : colors.success, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
            {item.quantityDelta > 0 ? '+' : ''}{item.quantityDelta} {item.unitLabel} - {movementTypeLabel(item.movementType)}
          </Text>
          <Text selectable style={{ color: colors.secondaryLabel }}>{item.description}</Text>
          <Text selectable style={{ color: colors.secondaryLabel }}>
            {item.createdAt}{item.serviceReportNumber ? ` - ${item.serviceReportNumber}` : ''}{item.billingStatementNumber ? ` - ${item.billingStatementNumber}` : ''}
          </Text>
        </Pressable>
      )}
    />
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ minWidth: 130, flex: 1, padding: 14, gap: 4, borderRadius: 12, backgroundColor: colors.surface }}>
      <Text selectable style={{ color: colors.secondaryLabel }}>{label}</Text>
      <Text selectable style={{ color: colors.label, fontSize: 21, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}
