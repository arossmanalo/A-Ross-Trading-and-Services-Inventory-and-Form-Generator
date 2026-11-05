import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { formatCentavos, parseCurrencyToCentavos } from '@/domain/money';
import { addDeliveryItemLine } from '@/features/deliveries/delivery-repository';
import { listInventoryItems } from '@/features/inventory/inventory-repository';
import { ItemPicker } from '@/features/inventory/item-picker';
import type { InventoryItemSummary } from '@/features/inventory/inventory-types';
import { colors } from '@/theme/colors';

export default function NewDeliveryItemScreen() {
  const { deliveryId } = useLocalSearchParams<{ deliveryId: string }>();
  const db = useSQLiteContext();
  const [items, setItems] = useState<InventoryItemSummary[]>([]);
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await listInventoryItems(db)).filter((entry) => entry.active));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load inventory.');
    }
  }, [db]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = items.find((entry) => entry.id === itemId);
  const requested = Number(quantity);
  const short = selected && Number.isSafeInteger(requested) && requested > selected.currentStock;

  const save = useCallback(async () => {
    if (!deliveryId) return;
    setSaving(true);
    setError(null);
    try {
      const count = Number(quantity);
      if (!Number.isSafeInteger(count) || count < 1) throw new Error('Quantity must be a whole number of at least 1.');
      const unitPrice = price.trim() ? parseCurrencyToCentavos(price) : undefined;
      if (price.trim() && unitPrice === null) throw new Error('Enter the price as an amount such as 1,250.00.');
      await addDeliveryItemLine(db, deliveryId, { itemId, quantity: count, unitPriceCentavos: unitPrice ?? undefined, overrideReason: reason });
      router.back();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not add the item.');
    } finally {
      setSaving(false);
    }
  }, [db, deliveryId, itemId, price, quantity, reason]);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text selectable style={styles.eyebrow}>ADD AN INVENTORY ITEM</Text>
      <ItemPicker items={items} selectedId={itemId} onSelect={setItemId} onCreated={async (id) => { await load(); setItemId(id); }} />
      {selected ? (
        <View style={styles.editor}>
          <Text selectable style={styles.selectedTitle}>{selected.name}</Text>
          <Text selectable style={styles.help}>{selected.currentStock} {selected.unitLabel} in stock · list price {formatCentavos(selected.baseSellingPriceCentavos)}. A customer-specific price is used automatically.</Text>
          <FormField keyboardType="number-pad" label="Quantity to deliver" onChangeText={setQuantity} value={quantity} />
          {short ? <Text selectable style={styles.warning}>Only {selected.currentStock} in stock. You can keep this on the draft, but the delivery cannot be finalized until stock is enough.</Text> : null}
          <FormField keyboardType="decimal-pad" label="Unit price (optional)" onChangeText={setPrice} placeholder="Leave blank to use the resolved price" value={price} />
          {price.trim() ? <FormField label="Reason for the different price" onChangeText={setReason} value={reason} /> : null}
        </View>
      ) : null}
      {error ? <Text selectable style={styles.error}>{error}</Text> : null}
      <ActionButton disabled={saving || !itemId} onPress={() => void save()}>{saving ? 'Adding…' : 'Add to delivery'}</ActionButton>
      <ActionButton disabled={saving} variant="secondary" onPress={() => router.back()}>Cancel</ActionButton>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, padding: 18, paddingBottom: 44 },
  eyebrow: { color: colors.brandBlue, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  editor: { gap: 12, padding: 15, backgroundColor: '#eaf2ff', borderRadius: 16, borderCurve: 'continuous' },
  selectedTitle: { color: colors.brandNavy, fontSize: 17, fontWeight: '900' },
  help: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
  warning: { color: colors.warning, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  error: { color: colors.error, fontSize: 13, fontWeight: '600' },
});
