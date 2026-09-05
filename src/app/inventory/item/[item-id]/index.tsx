import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { formatCentavos } from '@/domain/money';
import {
  getInventoryItemDetail,
  listInventoryMovements,
  setInventoryItemActive,
} from '@/features/inventory/inventory-repository';
import type {
  InventoryItemDetail,
  InventoryMovementSummary,
} from '@/features/inventory/inventory-types';
import { colors } from '@/theme/colors';

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const MovementRow = memo(function MovementRow({ movement }: { movement: InventoryMovementSummary }) {
  const incoming = movement.quantityDelta > 0;
  return (
    <View style={styles.movementRow}>
      <View style={styles.movementCopy}>
        <Text selectable style={styles.movementDescription}>{movement.description}</Text>
        <Text selectable style={styles.movementMeta}>
          {formatMovementType(movement.movementType)} · {formatDateTime(movement.createdAt)}
        </Text>
      </View>
      <Text selectable style={[styles.movementQuantity, incoming ? styles.incoming : styles.outgoing]}>
        {incoming ? '+' : ''}{movement.quantityDelta}
      </Text>
    </View>
  );
});

export default function InventoryItemDetailScreen() {
  const { 'item-id': itemId } = useLocalSearchParams<{ 'item-id': string }>();
  const db = useSQLiteContext();
  const [item, setItem] = useState<InventoryItemDetail | null>(null);
  const [movements, setMovements] = useState<InventoryMovementSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadItem = useCallback(async () => {
    if (!itemId) {
      setError('Inventory item identifier is missing.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [detail, movementRows] = await Promise.all([
        getInventoryItemDetail(db, itemId),
        listInventoryMovements(db, itemId),
      ]);
      if (!detail) throw new Error('Inventory item was not found.');
      setItem(detail);
      setMovements(movementRows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load inventory item.');
    } finally {
      setLoading(false);
    }
  }, [db, itemId]);

  useFocusEffect(
    useCallback(() => {
      void loadItem();
    }, [loadItem]),
  );

  const openMovement = useCallback((movementType: 'consumption' | 'restock') => {
    if (!itemId) return;
    router.push({
      pathname: '/inventory/item/[item-id]/movement',
      params: { 'item-id': itemId, movementType },
    });
  }, [itemId]);

  const confirmActiveToggle = useCallback(() => {
    if (!item) return;
    const nextActive = !item.active;
    Alert.alert(
      nextActive ? 'Reactivate item?' : 'Deactivate item?',
      nextActive
        ? 'The item will be available for new service and billing lines.'
        : 'History stays intact and manual stock corrections remain available.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextActive ? 'Reactivate' : 'Deactivate',
          style: nextActive ? 'default' : 'destructive',
          onPress: () => {
            void setInventoryItemActive(db, item.id, nextActive)
              .then(loadItem)
              .catch((toggleError: unknown) => {
                setError(toggleError instanceof Error ? toggleError.message : 'Could not update item.');
              });
          },
        },
      ],
    );
  }, [db, item, loadItem]);

  if (loading && !item) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.brandBlue} size="large" />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: item?.name ?? 'Inventory item' }} />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        data={movements}
        keyExtractor={getMovementKey}
        renderItem={renderMovement}
        ItemSeparatorComponent={MovementSeparator}
        refreshing={loading}
        onRefresh={loadItem}
        ListHeaderComponent={
          <View style={styles.headerContent}>
            {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
            {item ? (
              <>
                <View style={styles.stockCard}>
                  <View style={styles.stockHeading}>
                    <View style={styles.flexCopy}>
                      <Text selectable style={styles.eyebrow}>CURRENT STOCK</Text>
                      <Text selectable style={styles.stockValue}>
                        {item.currentStock} <Text style={styles.stockUnit}>{item.unitLabel}</Text>
                      </Text>
                    </View>
                    <Text selectable style={item.active ? styles.activeBadge : styles.inactiveBadge}>
                      {item.active ? 'ACTIVE' : 'INACTIVE'}
                    </Text>
                  </View>
                  <View style={styles.priceRow}>
                    <Text selectable style={styles.priceLabel}>Selling price</Text>
                    <Text selectable style={styles.priceValue}>{formatCentavos(item.baseSellingPriceCentavos)}</Text>
                  </View>
                  <View style={styles.priceRow}>
                    <Text selectable style={styles.priceLabel}>Low-stock threshold</Text>
                    <Text selectable style={styles.priceValue}>{item.lowStockThreshold}</Text>
                  </View>
                  {item.sku ? <Text selectable style={styles.description}>SKU: {item.sku}</Text> : null}
                  {item.description ? <Text selectable style={styles.description}>{item.description}</Text> : null}
                  <View style={styles.actionRow}>
                    <ActionButton onPress={() => openMovement('restock')} style={styles.actionButton}>
                      Restock
                    </ActionButton>
                    <ActionButton
                      onPress={() => openMovement('consumption')}
                      style={styles.actionButton}
                      variant="secondary"
                    >
                      Consume
                    </ActionButton>
                  </View>
                  <ActionButton onPress={confirmActiveToggle} variant="secondary">
                    {item.active ? 'Deactivate item' : 'Reactivate item'}
                  </ActionButton>
                </View>

                <View style={styles.sectionHeader}>
                  <Text selectable style={styles.sectionTitle}>Movement history</Text>
                  <Text selectable style={styles.sectionCaption}>
                    Append-only log; the displayed stock is the sum of these entries.
                  </Text>
                </View>
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          item ? (
            <View style={styles.emptyHistory}>
              <Text selectable style={styles.emptyTitle}>No movements recorded</Text>
            </View>
          ) : null
        }
      />
    </>
  );
}

function getMovementKey(movement: InventoryMovementSummary) {
  return movement.id;
}

function renderMovement({ item }: { item: InventoryMovementSummary }) {
  return <MovementRow movement={item} />;
}

function MovementSeparator() {
  return <View style={styles.separator} />;
}

function formatMovementType(type: InventoryMovementSummary['movementType']): string {
  return type.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase());
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : DATE_TIME_FORMATTER.format(date);
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  content: { padding: 18, paddingBottom: 44 },
  headerContent: { gap: 24, paddingBottom: 12 },
  stockCard: {
    gap: 13,
    padding: 18,
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderCurve: 'continuous',
    boxShadow: '0 2px 12px rgba(15, 23, 42, 0.07)',
  },
  stockHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  flexCopy: { flex: 1, gap: 4 },
  eyebrow: {
    color: colors.brandBlue,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  stockValue: {
    color: colors.label,
    fontSize: 34,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  stockUnit: { color: colors.secondaryLabel, fontSize: 16, fontWeight: '700' },
  activeBadge: { color: colors.success, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  inactiveBadge: { color: colors.secondaryLabel, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 14 },
  priceLabel: { color: colors.secondaryLabel, fontSize: 13 },
  priceValue: { color: colors.label, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  description: { color: colors.label, fontSize: 13, lineHeight: 19 },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionButton: { flex: 1 },
  sectionHeader: { gap: 4 },
  sectionTitle: { color: colors.label, fontSize: 19, fontWeight: '900' },
  sectionCaption: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
  movementRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
  },
  movementCopy: { flex: 1, gap: 4 },
  movementDescription: { color: colors.label, fontSize: 15, fontWeight: '700' },
  movementMeta: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 17 },
  movementQuantity: { fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  incoming: { color: colors.success },
  outgoing: { color: colors.error },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  emptyHistory: { alignItems: 'center', padding: 30 },
  emptyTitle: { color: colors.secondaryLabel, fontSize: 15, fontWeight: '700' },
  errorText: { color: colors.error, fontSize: 13, lineHeight: 19 },
});
