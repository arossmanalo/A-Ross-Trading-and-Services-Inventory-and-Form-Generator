import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { ChoiceChips } from '@/components/choice-chips';
import { FormField } from '@/components/form-field';
import { usePinGate } from '@/components/pin-gate';
import { parseCurrencyToCentavos } from '@/domain/money';
import { INVENTORY_KIND_OPTIONS } from '@/features/inventory/inventory-kind';
import {
  DuplicateSkuError,
  getInventoryItemDetail,
  setInventoryItemStock,
  updateInventoryItem,
} from '@/features/inventory/inventory-repository';
import type { InventoryKind } from '@/features/inventory/inventory-types';
import { colors } from '@/theme/colors';

export default function EditInventoryItemScreen() {
  const { 'item-id': itemId } = useLocalSearchParams<{ 'item-id': string }>();
  const db = useSQLiteContext();
  const { requirePin, pinPrompt } = usePinGate();
  const [inventoryKind, setInventoryKind] = useState<InventoryKind>('supply');
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unitLabel, setUnitLabel] = useState('pc');
  const [sellingPrice, setSellingPrice] = useState('0.00');
  const [lowStockThreshold, setLowStockThreshold] = useState('0');
  const [description, setDescription] = useState('');
  const [loadedStock, setLoadedStock] = useState<number | null>(null);
  const [quantity, setQuantity] = useState('');
  const [countReason, setCountReason] = useState('');
  const [duplicateSku, setDuplicateSku] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!itemId) return;
    void getInventoryItemDetail(db, itemId)
      .then((item) => {
        if (!item) throw new Error('Inventory item was not found.');
        setInventoryKind(item.inventoryKind);
        setName(item.name);
        setSku(item.sku ?? '');
        setUnitLabel(item.unitLabel);
        setSellingPrice((item.baseSellingPriceCentavos / 100).toFixed(2));
        setLowStockThreshold(String(item.lowStockThreshold));
        setDescription(item.description);
        setLoadedStock(item.currentStock);
        setQuantity(String(item.currentStock));
      })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load the item.'));
  }, [db, itemId]);

  const quantityChanged = loadedStock !== null && quantity.trim() !== String(loadedStock);

  const save = useCallback(async (allowDuplicateSku: boolean) => {
    if (!itemId) return;
    setSaving(true);
    setError(null);
    try {
      if (!/^\d+$/.test(lowStockThreshold.trim())) throw new Error('Low-stock threshold must be a non-negative whole number.');
      if (quantityChanged && !/^\d+$/.test(quantity.trim())) throw new Error('Quantity on hand must be a non-negative whole number.');
      if (quantityChanged && !countReason.trim()) throw new Error('Say why the quantity changed, for example "Shelf count".');
      await updateInventoryItem(db, itemId, {
        inventoryKind,
        name,
        sku,
        unitLabel,
        description,
        baseSellingPriceCentavos: parseCurrencyToCentavos(sellingPrice || '0'),
        lowStockThreshold: Number.parseInt(lowStockThreshold, 10),
        allowDuplicateSku,
      });
      if (quantityChanged) {
        await setInventoryItemStock(db, { itemId, quantity: Number.parseInt(quantity, 10), reason: countReason });
      }
      router.back();
    } catch (saveError) {
      if (saveError instanceof DuplicateSkuError) setDuplicateSku(saveError.sku);
      setError(saveError instanceof Error ? saveError.message : 'Could not save the item.');
    } finally {
      setSaving(false);
    }
  }, [countReason, db, description, inventoryKind, itemId, lowStockThreshold, name, quantity, quantityChanged, sellingPrice, sku, unitLabel]);

  // A quantity change needs the PIN; other edits do not.
  const submit = useCallback((allowDuplicateSku: boolean) => {
    if (quantityChanged) requirePin('change the quantity on hand', () => void save(allowDuplicateSku));
    else void save(allowDuplicateSku);
  }, [quantityChanged, requirePin, save]);

  return (
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <Stack.Screen options={{ title: 'Edit inventory item' }} />
      {pinPrompt}
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Text selectable style={styles.eyebrow}>EDIT ITEM</Text>
          <Text selectable style={styles.introText}>
            Update the catalog details. Changing the quantity on hand needs the inventory PIN and is saved as a stock count in the movement history.
          </Text>
        </View>
        <ChoiceChips label="Inventory" options={INVENTORY_KIND_OPTIONS} value={inventoryKind} onChange={setInventoryKind} />
        <FormField autoCapitalize="words" label="Item name" onChangeText={setName} value={name} />
        <FormField
          autoCapitalize="characters"
          label="SKU or code (optional)"
          onChangeText={(value) => {
            setSku(value);
            setDuplicateSku(null);
          }}
          value={sku}
        />
        <View style={styles.twoColumns}>
          <FormField containerStyle={styles.column} label="Unit" onChangeText={setUnitLabel} value={unitLabel} />
          <FormField containerStyle={styles.column} keyboardType="decimal-pad" label="Selling price" onChangeText={setSellingPrice} value={sellingPrice} />
        </View>
        <View style={styles.twoColumns}>
          <FormField
            containerStyle={styles.column}
            hint={loadedStock === null ? undefined : `Currently ${loadedStock} ${unitLabel}`}
            keyboardType="number-pad"
            label="Quantity on hand"
            onChangeText={setQuantity}
            value={quantity}
          />
          <FormField containerStyle={styles.column} keyboardType="number-pad" label="Low-stock threshold" onChangeText={setLowStockThreshold} value={lowStockThreshold} />
        </View>
        {quantityChanged ? (
          <FormField
            label="Reason for the quantity change"
            onChangeText={setCountReason}
            placeholder="Shelf count, damaged units, found stock"
            value={countReason}
          />
        ) : null}
        <FormField label="Description (optional)" multiline onChangeText={setDescription} style={styles.multiline} textAlignVertical="top" value={description} />
        {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
        <View style={styles.actions}>
          {duplicateSku ? (
            <ActionButton disabled={saving} onPress={() => submit(true)} variant="danger">Save duplicate SKU anyway</ActionButton>
          ) : null}
          <ActionButton disabled={saving} onPress={() => submit(false)}>{saving ? 'Saving…' : 'Save changes'}</ActionButton>
          <ActionButton disabled={saving} onPress={() => router.back()} variant="secondary">Cancel</ActionButton>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { gap: 18, padding: 18, paddingBottom: 44 },
  intro: { gap: 6, padding: 16, backgroundColor: colors.accentTint, borderRadius: 10, borderCurve: 'continuous' },
  eyebrow: { color: colors.brandBlue, fontSize: 13, fontWeight: '600', letterSpacing: 1 },
  introText: { color: colors.brandNavy, fontSize: 15, lineHeight: 20 },
  twoColumns: { flexDirection: 'row', gap: 12 },
  column: { flex: 1, minWidth: 0 },
  multiline: { minHeight: 104 },
  actions: { gap: 10, paddingTop: 4 },
  errorText: { color: colors.error, fontSize: 15, lineHeight: 20, fontWeight: '600' },
});
