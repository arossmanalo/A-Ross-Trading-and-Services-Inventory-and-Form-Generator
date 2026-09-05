import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { formatCentavos, parseCurrencyToCentavos } from '@/domain/money';
import { listInventoryItems } from '@/features/inventory/inventory-repository';
import type { InventoryItemSummary } from '@/features/inventory/inventory-types';
import {
  listActiveCustomerPrices,
  setCustomerItemPrice,
} from '@/features/pricing/pricing-repository';
import type { CustomerItemPriceSummary } from '@/features/pricing/pricing-types';
import { colors } from '@/theme/colors';

export default function SetCustomerPriceScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const db = useSQLiteContext();
  const [items, setItems] = useState<InventoryItemSummary[]>([]);
  const [existingPrices, setExistingPrices] = useState<CustomerItemPriceSummary[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!customerId) {
      setError('Customer identifier is missing.');
      setLoading(false);
      return;
    }
    void Promise.all([listInventoryItems(db), listActiveCustomerPrices(db, customerId)])
      .then(([itemRows, priceRows]) => {
        setItems(itemRows.filter((item) => item.active));
        setExistingPrices(priceRows);
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not load item pricing.');
      })
      .finally(() => setLoading(false));
  }, [customerId, db]);

  const pricesByItem = useMemo(
    () => new Map(existingPrices.map((entry) => [entry.itemId, entry.sellingPriceCentavos])),
    [existingPrices],
  );

  const selectItem = useCallback((item: InventoryItemSummary) => {
    setSelectedItemId(item.id);
    const current = pricesByItem.get(item.id) ?? item.baseSellingPriceCentavos;
    setPrice((current / 100).toFixed(2));
    setError(null);
  }, [pricesByItem]);

  const save = useCallback(async () => {
    if (!customerId || !selectedItemId) {
      setError('Select an inventory item.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setCustomerItemPrice(db, {
        customerId,
        itemId: selectedItemId,
        sellingPriceCentavos: parseCurrencyToCentavos(price),
      });
      router.back();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save customer price.');
    } finally {
      setSaving(false);
    }
  }, [customerId, db, price, selectedItemId]);

  return (
    <>
      <Stack.Screen options={{ title: 'Set customer price' }} />
      <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <FlatList
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.content}
          data={items}
          keyExtractor={getItemKey}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <PriceItemRow
              currentPrice={pricesByItem.get(item.id)}
              item={item}
              onSelect={selectItem}
              selected={item.id === selectedItemId}
            />
          )}
          ItemSeparatorComponent={ItemSeparator}
          ListHeaderComponent={
            <View style={styles.header}>
              <Text selectable style={styles.eyebrow}>SELECT ITEM</Text>
              <Text selectable style={styles.headerText}>
                Existing special prices are shown beside their base price.
              </Text>
              {selectedItemId ? (
                <View style={styles.editor}>
                  <FormField
                    keyboardType="decimal-pad"
                    label="New customer price"
                    onChangeText={setPrice}
                    placeholder="0.00"
                    value={price}
                  />
                  <ActionButton disabled={saving} onPress={() => void save()}>
                    {saving ? 'Saving…' : 'Save customer price'}
                  </ActionButton>
                </View>
              ) : null}
              {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
            </View>
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.emptyState}>
                <Text selectable style={styles.emptyTitle}>No active inventory items</Text>
              </View>
            ) : null
          }
        />
      </KeyboardAvoidingView>
    </>
  );
}

function PriceItemRow({
  currentPrice,
  item,
  onSelect,
  selected,
}: {
  currentPrice?: number;
  item: InventoryItemSummary;
  onSelect: (item: InventoryItemSummary) => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onSelect(item)}
      style={({ pressed }) => [
        styles.itemRow,
        selected ? styles.selectedRow : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={styles.itemCopy}>
        <Text selectable style={styles.itemName}>{item.name}</Text>
        <Text selectable style={styles.itemMeta}>
          Base {formatCentavos(item.baseSellingPriceCentavos)}{currentPrice === undefined ? '' : ` · Current ${formatCentavos(currentPrice)}`}
        </Text>
      </View>
      <Text selectable style={styles.selectLabel}>{selected ? 'SELECTED' : 'SELECT'}</Text>
    </Pressable>
  );
}

function getItemKey(item: InventoryItemSummary) {
  return item.id;
}

function ItemSeparator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 18, paddingBottom: 44 },
  header: { gap: 12, paddingVertical: 18 },
  eyebrow: { color: colors.brandBlue, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  headerText: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 },
  editor: { gap: 12, padding: 15, backgroundColor: '#eaf2ff', borderRadius: 16, borderCurve: 'continuous' },
  itemRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  selectedRow: { paddingHorizontal: 12, backgroundColor: '#eaf2ff', borderRadius: 14, borderCurve: 'continuous' },
  itemCopy: { flex: 1, gap: 4 },
  itemName: { color: colors.label, fontSize: 15, fontWeight: '800' },
  itemMeta: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 17 },
  selectLabel: { color: colors.brandBlue, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  emptyState: { alignItems: 'center', padding: 30 },
  emptyTitle: { color: colors.secondaryLabel, fontSize: 15, fontWeight: '700' },
  errorText: { color: colors.error, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  pressed: { opacity: 0.72 },
});
