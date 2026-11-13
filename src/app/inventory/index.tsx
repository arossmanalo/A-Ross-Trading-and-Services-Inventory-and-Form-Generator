import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { ListEmpty, listRowStyles } from '@/components/list-pane';
import { SplitView, useSplitLayout } from '@/components/split-view';
import { StatusChip } from '@/components/status-chip';
import { formatCentavos } from '@/domain/money';
import { InventoryItemDetailView } from '@/features/inventory/inventory-item-detail-view';
import { listInventoryItems } from '@/features/inventory/inventory-repository';
import type { InventoryItemSummary } from '@/features/inventory/inventory-types';
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

export default function InventoryScreen() {
  const db = useSQLiteContext();
  const split = useSplitLayout();
  const [items, setItems] = useState<InventoryItemSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listInventoryItems(db));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load inventory.');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(useCallback(() => { void loadItems(); }, [loadItems]));

  const openItem = useCallback((itemId: string) => {
    if (split) setSelectedId(itemId);
    else router.push({ pathname: '/inventory/item/[item-id]', params: { 'item-id': itemId } });
  }, [split]);

  const lowCount = items.filter((item) => item.active && item.currentStock <= item.lowStockThreshold).length;

  const list = (
    <FlatList
      data={items}
      extraData={`${selectedId}:${split}`}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <InventoryRow item={item} selected={split && item.id === selectedId} onOpen={openItem} />}
      refreshing={loading && items.length > 0}
      onRefresh={loadItems}
      ListHeaderComponent={(
        <View style={styles.header}>
          <ActionButton onPress={() => router.push('/inventory/new')}>Add item</ActionButton>
          <Text style={text.meta}>
            {items.length} item{items.length === 1 ? '' : 's'}{lowCount ? ` · ${lowCount} low on stock` : ''}. Every quantity comes from the append-only movement log.
          </Text>
          {error ? <Text style={text.error}>{error}</Text> : null}
        </View>
      )}
      ListEmptyComponent={loading
        ? <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 32 }} />
        : <ListEmpty title="No inventory yet" body="Add the first item and record its opening stock." />}
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
