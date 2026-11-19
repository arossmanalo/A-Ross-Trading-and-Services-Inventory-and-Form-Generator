import { Stack, router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { usePinGate } from '@/components/pin-gate';
import { RecordHeader } from '@/components/record-layout';
import { StatusChip, sentenceCase } from '@/components/status-chip';
import { formatCentavos } from '@/domain/money';
import { INVENTORY_LABELS } from '@/features/inventory/inventory-kind';
import {
  deleteInventoryItem,
  getInventoryItemDetail,
  listInventoryMovements,
  setInventoryItemActive,
} from '@/features/inventory/inventory-repository';
import type { InventoryItemDetail, InventoryMovementSummary } from '@/features/inventory/inventory-types';
import { colors } from '@/theme/colors';
import { fontSize, radius, spacing, text } from '@/theme/typography';

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

const MovementRow = memo(function MovementRow({ movement, first }: { movement: InventoryMovementSummary; first: boolean }) {
  const incoming = movement.quantityDelta > 0;
  return (
    <View style={[styles.movementRow, first ? styles.firstMovement : null]}>
      <View style={styles.movementCopy}>
        <Text selectable style={text.body}>{movement.description}</Text>
        <Text selectable style={text.meta}>{sentenceCase(movement.movementType)} · {formatDateTime(movement.createdAt)}</Text>
      </View>
      <Text selectable style={[styles.quantity, incoming ? styles.incoming : styles.outgoing]}>
        {incoming ? '+' : ''}{movement.quantityDelta}
      </Text>
    </View>
  );
});

type InventoryItemDetailViewProps = {
  itemId: string;
  embedded?: boolean;
  onChanged?: () => void;
};

export function InventoryItemDetailView({ itemId, embedded = false, onChanged }: InventoryItemDetailViewProps) {
  const db = useSQLiteContext();
  const [item, setItem] = useState<InventoryItemDetail | null>(null);
  const [movements, setMovements] = useState<InventoryMovementSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { requirePin, pinPrompt } = usePinGate();

  const loadItem = useCallback(async () => {
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

  useFocusEffect(useCallback(() => { void loadItem(); }, [loadItem]));

  const openMovement = useCallback((movementType: 'consumption' | 'restock') => {
    router.push({ pathname: '/inventory/item/[item-id]/movement', params: { 'item-id': itemId, movementType } });
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
              .then(async () => {
                await loadItem();
                onChanged?.();
              })
              .catch((toggleError: unknown) => {
                setError(toggleError instanceof Error ? toggleError.message : 'Could not update item.');
              });
          },
        },
      ],
    );
  }, [db, item, loadItem, onChanged]);

  const confirmDelete = useCallback(() => {
    if (!item) return;
    requirePin(`delete ${item.name}`, () => {
      Alert.alert(
        `Delete ${item.name}?`,
        'It disappears from inventory, pickers and stock reports. If a CSR, delivery, quotation or statement used it, those documents keep showing it. This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void deleteInventoryItem(db, item.id)
                .then(() => {
                  onChanged?.();
                  if (!embedded) router.back();
                })
                .catch((deleteError: unknown) => {
                  setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the item.');
                });
            },
          },
        ],
      );
    });
  }, [db, embedded, item, onChanged, requirePin]);

  if (loading && !item) return <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>;
  if (!item) return <View style={styles.centered}><Text selectable style={text.error}>{error ?? 'Inventory item was not found.'}</Text></View>;

  const lowStock = item.active && item.currentStock <= item.lowStockThreshold;

  return (
    <>
      {embedded ? null : <Stack.Screen options={{ title: item.name }} />}
      {pinPrompt}
      <FlatList
        contentContainerStyle={styles.content}
        data={movements}
        keyExtractor={(movement) => movement.id}
        renderItem={({ item: movement, index }) => <MovementRow movement={movement} first={index === 0} />}
        refreshing={loading}
        onRefresh={loadItem}
        ListHeaderComponent={(
          <View style={styles.header}>
            <RecordHeader
              title={item.name}
              chips={item.deletedAt
                ? <StatusChip label="Deleted" tone="void" />
                : <StatusChip label={item.active ? 'Active' : 'Inactive'} tone={item.active ? 'final' : 'neutral'} />}
              subtitle={[INVENTORY_LABELS[item.inventoryKind].singular, item.sku ? `SKU ${item.sku}` : 'No SKU', `unit ${item.unitLabel}`, item.description].filter(Boolean).join(' · ')}
              actions={item.deletedAt ? null : (
                <>
                  <ActionButton compact variant="danger" onPress={confirmDelete}>Delete</ActionButton>
                  <ActionButton compact variant={item.active ? 'danger' : 'secondary'} onPress={confirmActiveToggle}>
                    {item.active ? 'Deactivate' : 'Reactivate'}
                  </ActionButton>
                  <ActionButton compact variant="secondary" onPress={() => router.push({ pathname: '/inventory/item/[item-id]/edit', params: { 'item-id': item.id } })}>Edit</ActionButton>
                  <ActionButton compact variant="secondary" onPress={() => openMovement('consumption')}>Consume</ActionButton>
                  <ActionButton compact onPress={() => openMovement('restock')}>Restock</ActionButton>
                </>
              )}
            />
            {error ? <Text accessibilityLiveRegion="polite" selectable style={text.error}>{error}</Text> : null}
            <View style={styles.figures}>
              <View style={styles.figure}>
                <Text style={text.meta}>Current stock</Text>
                <Text style={[styles.figureLarge, lowStock ? styles.low : null]}>{item.currentStock} {item.unitLabel}</Text>
                {lowStock ? <Text style={[text.meta, styles.low]}>At or below the low-stock level</Text> : null}
              </View>
              <View style={[styles.figure, styles.figureDivider]}>
                <Text style={text.meta}>Selling price</Text>
                <Text style={styles.figureValue}>{formatCentavos(item.baseSellingPriceCentavos)}</Text>
              </View>
              <View style={[styles.figure, styles.figureDivider]}>
                <Text style={text.meta}>Low-stock threshold</Text>
                <Text style={styles.figureValue}>{item.lowStockThreshold}</Text>
              </View>
            </View>
            <View style={styles.historyHeading}>
              <Text accessibilityRole="header" style={text.subhead}>Movement history</Text>
              <Text style={text.meta}>Append-only log; the stock shown is the sum of these entries.</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={[text.meta, styles.empty]}>No movements recorded.</Text>}
        ListFooterComponent={movements.length ? <View style={styles.footer} /> : null}
      />
    </>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : DATE_TIME_FORMATTER.format(date);
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  content: { padding: spacing.xxl, paddingBottom: 48 },
  header: { gap: spacing.lg, paddingBottom: spacing.md },
  figures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: radius.panel,
  },
  figure: { flexGrow: 1, flexBasis: 180, gap: 2, paddingVertical: 14, paddingHorizontal: spacing.xl },
  figureDivider: { borderLeftWidth: 1, borderLeftColor: colors.hairline },
  figureLarge: { color: colors.label, fontSize: fontSize.title, fontWeight: '600', fontVariant: ['tabular-nums'] },
  figureValue: { color: colors.label, fontSize: fontSize.section, fontWeight: '600', fontVariant: ['tabular-nums'] },
  low: { color: colors.error },
  historyHeading: { gap: 2 },
  movementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: colors.separator,
  },
  firstMovement: { borderTopWidth: 1, borderTopLeftRadius: radius.panel, borderTopRightRadius: radius.panel },
  movementCopy: { flex: 1, minWidth: 0, gap: 2 },
  quantity: { minWidth: 56, textAlign: 'right', fontSize: fontSize.subhead, fontWeight: '600', fontVariant: ['tabular-nums'] },
  incoming: { color: colors.success },
  outgoing: { color: colors.error },
  empty: { paddingVertical: spacing.lg },
  footer: { height: 1, marginHorizontal: 0 },
});
