import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { formatCentavos } from '@/domain/money';
import { listInventoryItems } from '@/features/inventory/inventory-repository';
import type { InventoryItemSummary } from '@/features/inventory/inventory-types';
import { addReportItemUsage } from '@/features/service-reports/service-report-repository';
import { colors } from '@/theme/colors';

export default function NewReportItemUsageScreen() {
  const { reportId } = useLocalSearchParams<{ reportId: string }>();
  const db = useSQLiteContext();
  const [items, setItems] = useState<InventoryItemSummary[]>([]);
  const [selectedItem, setSelectedItem] = useState<InventoryItemSummary | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [billable, setBillable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void listInventoryItems(db)
      .then((rows) => setItems(rows.filter((item) => item.active)))
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load inventory.'));
  }, [db]);

  const save = useCallback(async () => {
    if (!reportId || !selectedItem) {
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
      await addReportItemUsage(db, reportId, selectedItem.id, parsed, billable);
      router.back();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not add item usage.');
    } finally {
      setSaving(false);
    }
  }, [billable, db, quantity, reportId, selectedItem]);

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      data={items}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => setSelectedItem(item)}
          style={[styles.itemRow, selectedItem?.id === item.id ? styles.selectedRow : null]}
        >
          <View style={styles.itemCopy}>
            <Text selectable style={styles.itemName}>{item.name}</Text>
            <Text selectable style={styles.itemMeta}>{formatCentavos(item.baseSellingPriceCentavos)} · {item.currentStock} {item.unitLabel} available</Text>
          </View>
          <Text selectable style={styles.selectLabel}>{selectedItem?.id === item.id ? 'SELECTED' : 'SELECT'}</Text>
        </Pressable>
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text selectable style={styles.eyebrow}>ITEM USED</Text>
          <Text selectable style={styles.help}>Draft selection does not deduct stock. Availability is checked again at finalization.</Text>
          {selectedItem ? (
            <View style={styles.editor}>
              <Text selectable style={styles.selectedName}>{selectedItem.name}</Text>
              <FormField keyboardType="number-pad" label="Quantity" onChangeText={setQuantity} value={quantity} />
              <View style={styles.switchRow}>
                <View style={styles.itemCopy}>
                  <Text selectable style={styles.switchTitle}>Billable to customer</Text>
                  <Text selectable style={styles.itemMeta}>Non-billable usage still deducts inventory.</Text>
                </View>
                <Switch accessibilityLabel="Billable to customer" onValueChange={setBillable} value={billable} />
              </View>
              <ActionButton disabled={saving} onPress={() => void save()}>{saving ? 'Adding…' : 'Add item usage'}</ActionButton>
            </View>
          ) : null}
          {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingBottom: 44 },
  header: { gap: 12, paddingVertical: 18 },
  eyebrow: { color: colors.brandBlue, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  help: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
  editor: { gap: 12, padding: 15, backgroundColor: '#eaf2ff', borderRadius: 16, borderCurve: 'continuous' },
  selectedName: { color: colors.brandNavy, fontSize: 17, fontWeight: '900' },
  switchRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchTitle: { color: colors.label, fontSize: 14, fontWeight: '800' },
  itemRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  selectedRow: { paddingHorizontal: 12, backgroundColor: '#eaf2ff', borderRadius: 14, borderCurve: 'continuous' },
  itemCopy: { flex: 1, gap: 4 },
  itemName: { color: colors.label, fontSize: 15, fontWeight: '800' },
  itemMeta: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 17 },
  selectLabel: { color: colors.brandBlue, fontSize: 9, fontWeight: '900', letterSpacing: .7 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  errorText: { color: colors.error, fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
