import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { parseCurrencyToCentavos } from '@/domain/money';
import { DuplicateSkuError, getInventoryItemDetail, updateInventoryItem } from '@/features/inventory/inventory-repository';
import { colors } from '@/theme/colors';

export default function EditInventoryItemScreen() {
  const { 'item-id': itemId } = useLocalSearchParams<{ 'item-id': string }>();
  const db = useSQLiteContext();
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unitLabel, setUnitLabel] = useState('pc');
  const [sellingPrice, setSellingPrice] = useState('0.00');
  const [lowStockThreshold, setLowStockThreshold] = useState('0');
  const [description, setDescription] = useState('');
  const [duplicateSku, setDuplicateSku] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!itemId) return;
    void getInventoryItemDetail(db, itemId).then((item) => {
      if (!item) throw new Error('Inventory item was not found.');
      setName(item.name); setSku(item.sku ?? ''); setUnitLabel(item.unitLabel);
      setSellingPrice((item.baseSellingPriceCentavos / 100).toFixed(2));
      setLowStockThreshold(String(item.lowStockThreshold)); setDescription(item.description);
    }).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load the item.'));
  }, [db, itemId]);

  const save = useCallback(async (allowDuplicateSku: boolean) => {
    if (!itemId) return;
    setSaving(true); setError(null);
    try {
      if (!/^\d+$/.test(lowStockThreshold.trim())) throw new Error('Low-stock threshold must be a non-negative whole number.');
      await updateInventoryItem(db, itemId, {
        name, sku, unitLabel, description,
        baseSellingPriceCentavos: parseCurrencyToCentavos(sellingPrice || '0'),
        lowStockThreshold: Number.parseInt(lowStockThreshold, 10),
        allowDuplicateSku,
      });
      router.back();
    } catch (saveError) {
      if (saveError instanceof DuplicateSkuError) setDuplicateSku(saveError.sku);
      setError(saveError instanceof Error ? saveError.message : 'Could not save the item.');
    } finally { setSaving(false); }
  }, [db, description, itemId, lowStockThreshold, name, sellingPrice, sku, unitLabel]);

  return <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
    <Stack.Screen options={{ title: 'Edit inventory item' }} />
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <View style={styles.intro}><Text selectable style={styles.eyebrow}>EDIT ITEM</Text><Text selectable style={styles.introText}>Update the catalog details without changing existing stock movements.</Text></View>
      <FormField autoCapitalize="words" label="Item name" onChangeText={setName} value={name} />
      <FormField autoCapitalize="characters" label="SKU or code (optional)" onChangeText={(value) => { setSku(value); setDuplicateSku(null); }} value={sku} />
      <View style={styles.twoColumns}><FormField containerStyle={styles.column} label="Unit" onChangeText={setUnitLabel} value={unitLabel} /><FormField containerStyle={styles.column} keyboardType="decimal-pad" label="Selling price" onChangeText={setSellingPrice} value={sellingPrice} /></View>
      <FormField keyboardType="number-pad" label="Low-stock threshold" onChangeText={setLowStockThreshold} value={lowStockThreshold} />
      <FormField label="Description (optional)" multiline onChangeText={setDescription} style={styles.multiline} textAlignVertical="top" value={description} />
      {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
      <View style={styles.actions}>
        {duplicateSku ? <ActionButton disabled={saving} onPress={() => void save(true)} variant="danger">Save duplicate SKU anyway</ActionButton> : null}
        <ActionButton disabled={saving} onPress={() => void save(false)}>{saving ? 'Saving…' : 'Save changes'}</ActionButton>
        <ActionButton disabled={saving} onPress={() => router.back()} variant="secondary">Cancel</ActionButton>
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({ flex: { flex: 1 }, content: { gap: 18, padding: 18, paddingBottom: 44 }, intro: { gap: 6, padding: 16, backgroundColor: '#eaf2ff', borderRadius: 16, borderCurve: 'continuous' }, eyebrow: { color: colors.brandBlue, fontSize: 10, fontWeight: '900', letterSpacing: 1 }, introText: { color: colors.brandNavy, fontSize: 14, lineHeight: 20 }, twoColumns: { flexDirection: 'row', gap: 12 }, column: { flex: 1, minWidth: 0 }, multiline: { minHeight: 104 }, actions: { gap: 10, paddingTop: 4 }, errorText: { color: colors.error, fontSize: 14, lineHeight: 20, fontWeight: '600' } });
