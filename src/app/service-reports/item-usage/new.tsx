import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { listInventoryItems } from '@/features/inventory/inventory-repository';
import { ItemPicker } from '@/features/inventory/item-picker';
import type { InventoryItemSummary } from '@/features/inventory/inventory-types';
import { addReportItemUsage } from '@/features/service-reports/service-report-repository';
import { colors } from '@/theme/colors';

export default function NewReportItemUsageScreen() {
  const { reportId } = useLocalSearchParams<{ reportId: string }>();
  const db = useSQLiteContext();
  const [items, setItems] = useState<InventoryItemSummary[]>([]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [billable, setBillable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadItems = useCallback(async () => {
    try {
      const rows = await listInventoryItems(db);
      setItems(rows.filter((item) => item.active));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load inventory.');
    }
  }, [db]);

  useFocusEffect(useCallback(() => { void loadItems(); }, [loadItems]));

  const selectItem = useCallback((itemId: string) => {
    setSelectedItemId(itemId);
    setQuantity('');
    setError(null);
  }, []);

  const handleItemCreated = useCallback(async (itemId: string) => {
    await loadItems();
    selectItem(itemId);
  }, [loadItems, selectItem]);

  const save = useCallback(async () => {
    if (!reportId || !selectedItemId) {
      setError('Select an item.');
      return;
    }
    const parsed = Number(quantity);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      setError('Quantity must be a positive whole number.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addReportItemUsage(db, reportId, selectedItemId, parsed, billable);
      router.back();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not add item usage.');
    } finally {
      setSaving(false);
    }
  }, [billable, db, quantity, reportId, selectedItemId]);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text selectable style={styles.eyebrow}>ITEM USED</Text>
      <Text selectable style={styles.help}>Draft selection does not deduct stock. Availability is checked again at finalization.</Text>

      <ItemPicker items={items} selectedId={selectedItemId} onSelect={selectItem} onCreated={handleItemCreated} />

      {selectedItemId ? (
        <View style={styles.editor}>
          <FormField keyboardType="number-pad" label="Quantity used" hint="Enter the number of units used for this CSR." onChangeText={setQuantity} placeholder="Enter a whole number" value={quantity} />
          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text selectable style={styles.switchTitle}>Billable to customer</Text>
              <Text selectable style={styles.itemMeta}>Non-billable usage still deducts inventory.</Text>
            </View>
            <Switch accessibilityLabel="Billable to customer" onValueChange={setBillable} value={billable} />
          </View>
          <ActionButton disabled={saving} onPress={() => void save()}>{saving ? 'Adding…' : 'Add item usage'}</ActionButton>
        </View>
      ) : null}
      {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, padding: 18, paddingBottom: 44 },
  eyebrow: { color: colors.brandBlue, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  help: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
  editor: { gap: 12, padding: 15, backgroundColor: '#eaf2ff', borderRadius: 16, borderCurve: 'continuous' },
  switchRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchCopy: { flex: 1, gap: 4 },
  switchTitle: { color: colors.label, fontSize: 14, fontWeight: '800' },
  itemMeta: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 17 },
  errorText: { color: colors.error, fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
