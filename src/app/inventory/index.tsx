import { Link, Stack, router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';

import { formatCentavos } from '@/domain/money';
import { listInventoryItems } from '@/features/inventory/inventory-repository';
import type { InventoryItemSummary } from '@/features/inventory/inventory-types';
import { colors } from '@/theme/colors';

const InventoryRow = memo(function InventoryRow({ item }: { item: InventoryItemSummary }) {
  const lowStock = item.active && item.currentStock <= item.lowStockThreshold;
  const openItem = useCallback(() => {
    router.push({
      pathname: '/inventory/item/[item-id]',
      params: { 'item-id': item.id },
    });
  }, [item.id]);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={openItem}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <View style={styles.rowMain}>
        <View style={styles.titleLine}>
          <Text selectable numberOfLines={1} style={styles.itemName}>{item.name}</Text>
          {!item.active ? <Text selectable style={styles.inactiveBadge}>INACTIVE</Text> : null}
        </View>
        <Text selectable style={styles.itemMeta}>
          {item.sku ? `${item.sku} · ` : ''}{formatCentavos(item.baseSellingPriceCentavos)} / {item.unitLabel}
        </Text>
      </View>
      <View style={[styles.stockPill, lowStock ? styles.stockPillLow : null]}>
        <Text selectable style={[styles.stockValue, lowStock ? styles.stockValueLow : null]}>
          {item.currentStock}
        </Text>
        <Text selectable style={[styles.stockUnit, lowStock ? styles.stockValueLow : null]}>
          {item.unitLabel}
        </Text>
      </View>
    </Pressable>
  );
});

export default function InventoryScreen() {
  useColorScheme();
  const db = useSQLiteContext();
  const [items, setItems] = useState<InventoryItemSummary[]>([]);
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

  useFocusEffect(
    useCallback(() => {
      void loadItems();
    }, [loadItems]),
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/inventory/new" asChild>
              <Pressable accessibilityRole="button" hitSlop={10}>
                <Text selectable style={styles.addButton}>Add</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={items.length === 0 ? styles.emptyContent : styles.content}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <InventoryRow item={item} />}
        ItemSeparatorComponent={RowSeparator}
        refreshing={loading && items.length > 0}
        onRefresh={loadItems}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text selectable style={styles.headerEyebrow}>STOCK ON HAND</Text>
            <Text selectable style={styles.headerText}>
              Every quantity comes from the append-only movement log.
            </Text>
            {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.brandBlue} size="large" />
          ) : (
            <View style={styles.emptyState}>
              <Text selectable style={styles.emptyTitle}>No inventory yet</Text>
              <Text selectable style={styles.emptyBody}>
                Add the first item and record its opening stock as a Restock movement.
              </Text>
              <Link href="/inventory/new" asChild>
                <Pressable accessibilityRole="button" style={styles.emptyAction}>
                  <Text selectable style={styles.emptyActionText}>Add first item</Text>
                </Pressable>
              </Link>
            </View>
          )
        }
      />
    </>
  );
}

function RowSeparator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 18,
    paddingBottom: 44,
  },
  emptyContent: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingBottom: 44,
  },
  header: {
    gap: 5,
    paddingVertical: 18,
  },
  headerEyebrow: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  headerText: {
    color: colors.secondaryLabel,
    fontSize: 14,
    lineHeight: 20,
  },
  addButton: {
    color: colors.brandBlue,
    fontSize: 16,
    fontWeight: '800',
  },
  row: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 13,
  },
  rowMain: {
    flex: 1,
    gap: 5,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemName: {
    flexShrink: 1,
    color: colors.label,
    fontSize: 16,
    fontWeight: '800',
  },
  itemMeta: {
    color: colors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
  },
  inactiveBadge: {
    color: colors.secondaryLabel,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  stockPill: {
    minWidth: 62,
    alignItems: 'center',
    gap: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#e8f2ff',
    borderRadius: 14,
    borderCurve: 'continuous',
  },
  stockPillLow: {
    backgroundColor: '#ffebe9',
  },
  stockValue: {
    color: colors.brandNavy,
    fontSize: 17,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  stockUnit: {
    color: colors.brandNavy,
    fontSize: 10,
    fontWeight: '700',
  },
  stockValueLow: {
    color: '#a01818',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 28,
  },
  emptyTitle: {
    color: colors.label,
    fontSize: 21,
    fontWeight: '900',
  },
  emptyBody: {
    maxWidth: 320,
    color: colors.secondaryLabel,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  emptyAction: {
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 20,
    backgroundColor: colors.brandBlue,
    borderRadius: 14,
    borderCurve: 'continuous',
  },
  emptyActionText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.72,
  },
});
