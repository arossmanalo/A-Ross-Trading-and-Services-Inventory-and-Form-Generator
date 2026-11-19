import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ListEmpty, listRowStyles, ListSearch, ListTitle } from '@/components/list-pane';
import { SplitView, useSplitLayout } from '@/components/split-view';
import { StatusChip } from '@/components/status-chip';
import { filterItemsByQuery } from '@/domain/item-search';
import { formatCentavos } from '@/domain/money';
import { InventoryItemDetailView } from '@/features/inventory/inventory-item-detail-view';
import { INVENTORY_LABELS } from '@/features/inventory/inventory-kind';
import { listInventoryItems } from '@/features/inventory/inventory-repository';
import type { InventoryItemSummary, InventoryKind } from '@/features/inventory/inventory-types';
import { colors } from '@/theme/colors';
import { fontSize, spacing, text } from '@/theme/typography';

type InventoryRowProps = { item: InventoryItemSummary; selected: boolean; onOpen: (itemId: string) => void };

const InventoryRow = memo(function InventoryRow({ item, selected, onOpen }: InventoryRowProps) {
  const lowStock = item.active && item.currentStock <= item.lowStockThreshold;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onOpen(item.id)}
      style={({ pressed }) => [listRowStyles.row, styles.row, selected ? listRowStyles.selected : null, pressed && !selected ? listRowStyles.pressed : null]}
    >
      <View style={styles.copy}>
        <View style={listRowStyles.titleLine}>
          <Text numberOfLines={1} style={[text.bodyStrong, styles.copy]}>{item.name}</Text>
          {!item.active ? <StatusChip label="Inactive" tone="neutral" /> : null}
        </View>
        <Text numberOfLines={1} style={text.meta}>
          {item.sku ? `${item.sku} · ` : ''}{formatCentavos(item.baseSellingPriceCentavos)} / {item.unitLabel}
        </Text>
      </View>
      <View style={styles.stock}>
        <Text style={[styles.stockValue, lowStock ? styles.low : null]}>{item.currentStock}</Text>
        <Text style={[text.meta, lowStock ? styles.low : null]}>{lowStock ? `${item.unitLabel} · low` : item.unitLabel}</Text>
      </View>
    </Pressable>
  );
});

const INTRO: Record<InventoryKind, string> = {
  supply: 'Parts and materials used on repairs. CSRs draw from this list.',
  product: 'Items sold to customers on deliveries, quotations and statements.',
};

/** Parts and Products are two separate lists over the same item and movement tables. */
export function InventoryListScreen({ inventoryKind }: { inventoryKind: InventoryKind }) {
  const labels = INVENTORY_LABELS[inventoryKind];
  const db = useSQLiteContext();
  const split = useSplitLayout();
  const [items, setItems] = useState<InventoryItemSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const visibleItems = useMemo(() => filterItemsByQuery(items, query), [items, query]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = (await listInventoryItems(db)).filter((item) => item.inventoryKind === inventoryKind);
      setItems(rows);
      // A deleted or moved item leaves the list, so it can no longer stay selected.
      setSelectedId((current) => (current && rows.some((item) => item.id === current) ? current : null));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load inventory.');
    } finally {
      setLoading(false);
    }
  }, [db, inventoryKind]);

  useFocusEffect(useCallback(() => { void loadItems(); }, [loadItems]));

  const openItem = useCallback((itemId: string) => {
    if (split) setSelectedId(itemId);
    else router.push({ pathname: '/inventory/item/[item-id]', params: { 'item-id': itemId } });
  }, [split]);

  const lowCount = items.filter((item) => item.active && item.currentStock <= item.lowStockThreshold).length;

  const list = (
    <FlatList
      data={visibleItems}
      keyboardShouldPersistTaps="handled"
      extraData={`${selectedId}:${split}`}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <InventoryRow item={item} selected={split && item.id === selectedId} onOpen={openItem} />}
      refreshing={loading && items.length > 0}
      onRefresh={loadItems}
      ListHeaderComponent={(
        <View style={styles.header}>
          <ListTitle
            title={labels.plural}
            subtitle={`${items.length} item${items.length === 1 ? '' : 's'}${lowCount ? ` · ${lowCount} low` : ''}`}
            actionLabel={`Add ${labels.singular.toLowerCase()}`}
            onAction={() => router.push({ pathname: '/inventory/new', params: { kind: inventoryKind } })}
          />
          <ListSearch query={query} onQueryChange={setQuery} placeholder="Search name, SKU or unit" />
          <Text style={text.meta}>{INTRO[inventoryKind]} Every quantity comes from the append-only movement log.</Text>
          {error ? <Text style={text.error}>{error}</Text> : null}
        </View>
      )}
      ListEmptyComponent={loading
        ? <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 32 }} />
        : items.length > 0
          ? <ListEmpty title="No matching items" body={`Nothing matches “${query.trim()}”. Check the spelling or search by SKU.`} />
          : <ListEmpty
              title={`No ${labels.plural.toLowerCase()} yet`}
              body={inventoryKind === 'product'
                ? 'Add a product, or move an existing item here from its edit screen.'
                : 'Add the first part and record its opening stock.'}
            />}
    />
  );

  if (!split) return list;

  return (
    <SplitView
      list={list}
      listWidth={360}
      detail={selectedId ? (
        <InventoryItemDetailView key={selectedId} embedded itemId={selectedId} onChanged={() => void loadItems()} />
      ) : null}
      emptyTitle="Select an item"
      emptyBody="Its stock, price and movement history open here."
    />
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.separator, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  copy: { flex: 1, minWidth: 0 },
  stock: { alignItems: 'flex-end', minWidth: 64 },
  stockValue: { color: colors.label, fontSize: fontSize.subhead, fontWeight: '600', fontVariant: ['tabular-nums'] },
  low: { color: colors.error },
});
