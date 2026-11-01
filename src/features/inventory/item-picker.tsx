import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { filterItemsForSelection } from '@/domain/item-search';
import { formatCentavos, parseCurrencyToCentavos } from '@/domain/money';
import { createInventoryItemWithOpeningStock, DuplicateSkuError } from '@/features/inventory/inventory-repository';
import type { InventoryItemSummary } from '@/features/inventory/inventory-types';
import { colors } from '@/theme/colors';

/** Results beyond this are hidden so a large catalog never floods the screen. */
const MAX_VISIBLE_RESULTS = 100;

type ItemPickerProps = {
  items: InventoryItemSummary[];
  selectedId: string;
  onSelect: (itemId: string) => void;
  /** Called after quick add. The parent should reload its items and then select the new one. */
  onCreated: (itemId: string) => Promise<void> | void;
};

export function ItemPicker({ items, selectedId, onSelect, onCreated }: ItemPickerProps) {
  const db = useSQLiteContext();
  const [query, setQuery] = useState('');
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unitLabel, setUnitLabel] = useState('pc');
  const [sellingPrice, setSellingPrice] = useState('');
  const [openingStock, setOpeningStock] = useState('0');
  const [duplicateSku, setDuplicateSku] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const matches = useMemo(() => filterItemsForSelection(items, query), [items, query]);
  const visible = matches.slice(0, MAX_VISIBLE_RESULTS);
  const selected = items.find((item) => item.id === selectedId);

  const openQuickAdd = useCallback(() => {
    setName(query.trim());
    setError(null);
    setDuplicateSku(null);
    setQuickAddOpen(true);
  }, [query]);

  const closeQuickAdd = useCallback(() => {
    setQuickAddOpen(false);
    setError(null);
    setDuplicateSku(null);
  }, []);

  const save = useCallback(async (allowDuplicateSku: boolean) => {
    setSaving(true);
    setError(null);
    try {
      if (!/^\d+$/.test(openingStock.trim())) throw new Error('Opening stock must be a non-negative whole number.');
      const quantity = Number.parseInt(openingStock, 10);
      const itemId = await createInventoryItemWithOpeningStock(db, {
        name,
        sku,
        unitLabel,
        baseSellingPriceCentavos: parseCurrencyToCentavos(sellingPrice || '0'),
        lowStockThreshold: 0,
        openingStock: quantity,
        openingStockDescription: quantity > 0 ? 'Opening stock' : 'Opening stock: zero',
        allowDuplicateSku,
      });
      setQuery('');
      setName('');
      setSku('');
      setUnitLabel('pc');
      setSellingPrice('');
      setOpeningStock('0');
      setQuickAddOpen(false);
      setDuplicateSku(null);
      await onCreated(itemId);
    } catch (saveError) {
      if (saveError instanceof DuplicateSkuError) setDuplicateSku(saveError.sku);
      setError(saveError instanceof Error ? saveError.message : 'Could not save the item.');
    } finally {
      setSaving(false);
    }
  }, [db, name, onCreated, openingStock, sellingPrice, sku, unitLabel]);

  if (selected) {
    return (
      <View style={styles.selectedCard}>
        <View style={styles.selectedCopy}>
          <Text selectable style={styles.selectedName}>{selected.name}</Text>
          <Text selectable style={styles.rowMeta}>
            {formatCentavos(selected.baseSellingPriceCentavos)} · {selected.currentStock} {selected.unitLabel} in stock
          </Text>
        </View>
        <ActionButton compact variant="secondary" onPress={() => onSelect('')}>Change</ActionButton>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FormField
        autoCapitalize="none"
        autoCorrect={false}
        label="Search inventory"
        onChangeText={setQuery}
        placeholder="Item name, SKU, or unit"
        returnKeyType="search"
        value={query}
      />
      <Text selectable style={styles.count}>
        {matches.length === 0
          ? 'No matching items'
          : matches.length > MAX_VISIBLE_RESULTS
            ? `Showing the first ${MAX_VISIBLE_RESULTS} of ${matches.length} items. Type more to narrow the list.`
            : `${matches.length} item${matches.length === 1 ? '' : 's'}`}
      </Text>

      {matches.length > 0 ? (
        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.list} testID="item-picker-list">
          {visible.map((item, index) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`Select ${item.name}`}
              onPress={() => onSelect(item.id)}
              style={({ pressed }) => [styles.row, index > 0 ? styles.rowDivider : null, pressed ? styles.pressed : null]}
            >
              <Text numberOfLines={1} style={styles.rowName}>{item.name}{item.sku ? ` · ${item.sku}` : ''}</Text>
              <Text numberOfLines={1} style={item.currentStock <= 0 ? styles.rowMetaOut : styles.rowMeta}>
                {formatCentavos(item.baseSellingPriceCentavos)} · {item.currentStock <= 0 ? 'Out of stock' : `${item.currentStock} ${item.unitLabel} available`}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {quickAddOpen ? (
        <View style={styles.quickAdd}>
          <Text selectable style={styles.quickAddTitle}>Quick add inventory item</Text>
          <FormField
            autoCapitalize="words"
            label="Item name"
            onChangeText={setName}
            placeholder="Bearing assembly"
            value={name}
          />
          <FormField
            autoCapitalize="characters"
            label="SKU or code (optional)"
            onChangeText={(value) => {
              setSku(value);
              setDuplicateSku(null);
            }}
            placeholder="BRG-001"
            value={sku}
          />
          <View style={styles.twoColumns}>
            <FormField containerStyle={styles.column} autoCapitalize="none" label="Unit" onChangeText={setUnitLabel} placeholder="pc" value={unitLabel} />
            <FormField containerStyle={styles.column} keyboardType="decimal-pad" label="Selling price" onChangeText={setSellingPrice} placeholder="0.00" value={sellingPrice} />
          </View>
          <FormField
            hint="Saved as an opening-stock Restock movement. Leave 0 if none is on hand yet."
            keyboardType="number-pad"
            label="Opening stock"
            onChangeText={setOpeningStock}
            placeholder="0"
            value={openingStock}
          />
          {error ? <Text selectable style={styles.error}>{error}</Text> : null}
          {duplicateSku ? (
            <ActionButton disabled={saving} variant="danger" onPress={() => void save(true)}>
              Save duplicate SKU anyway
            </ActionButton>
          ) : null}
          <ActionButton disabled={saving || !name.trim()} onPress={() => void save(false)}>
            {saving ? 'Saving…' : 'Save and select item'}
          </ActionButton>
          <ActionButton disabled={saving} variant="secondary" onPress={closeQuickAdd}>Cancel</ActionButton>
        </View>
      ) : (
        <ActionButton variant="secondary" onPress={openQuickAdd}>
          {query.trim() && matches.length === 0 ? `Add “${query.trim()}” as a new item` : 'Quick add a new item'}
        </ActionButton>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  count: { color: colors.secondaryLabel, fontSize: 12 },
  list: {
    maxHeight: 280,
    borderWidth: 1,
    borderColor: colors.separator,
    borderCurve: 'continuous',
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  row: { minHeight: 56, justifyContent: 'center', gap: 2, paddingHorizontal: 14, paddingVertical: 10 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowName: { color: colors.label, fontSize: 15, fontWeight: '700' },
  rowMeta: { color: colors.secondaryLabel, fontSize: 12 },
  rowMetaOut: { color: colors.error, fontSize: 12, fontWeight: '700' },
  pressed: { opacity: 0.72 },
  selectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.brandBlue,
    borderCurve: 'continuous',
    borderRadius: 14,
    backgroundColor: '#eaf2ff',
  },
  selectedCopy: { flex: 1, gap: 3 },
  selectedName: { color: colors.brandNavy, fontSize: 16, fontWeight: '800' },
  quickAdd: {
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.brandBlue,
    borderCurve: 'continuous',
    borderRadius: 14,
    backgroundColor: '#eaf2ff',
  },
  quickAddTitle: { color: colors.brandNavy, fontSize: 15, fontWeight: '800' },
  twoColumns: { flexDirection: 'row', gap: 12 },
  column: { flex: 1 },
  error: { color: colors.error, fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
