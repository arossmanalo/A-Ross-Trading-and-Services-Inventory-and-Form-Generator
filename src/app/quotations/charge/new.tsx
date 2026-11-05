import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { formatCentavos, parseCurrencyToCentavos } from '@/domain/money';
import { listInventoryItems } from '@/features/inventory/inventory-repository';
import { ItemPicker } from '@/features/inventory/item-picker';
import type { InventoryItemSummary } from '@/features/inventory/inventory-types';
import { addQuotationItemLine, addQuotationServiceLine } from '@/features/quotations/quotation-repository';
import { ServicePicker } from '@/features/services/service-picker';
import { listServices } from '@/features/services/service-repository';
import type { ServiceCatalogEntry } from '@/features/services/service-types';
import { colors } from '@/theme/colors';

type Mode = 'item' | 'service';

export default function NewQuotationChargeScreen() {
  const { quotationId } = useLocalSearchParams<{ quotationId: string }>();
  const db = useSQLiteContext();
  const [mode, setMode] = useState<Mode>('item');
  const [items, setItems] = useState<InventoryItemSummary[]>([]);
  const [services, setServices] = useState<ServiceCatalogEntry[]>([]);
  const [itemId, setItemId] = useState('');
  const [service, setService] = useState<ServiceCatalogEntry | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [itemRows, serviceRows] = await Promise.all([listInventoryItems(db), listServices(db)]);
      setItems(itemRows.filter((entry) => entry.active));
      setServices(serviceRows.filter((entry) => entry.active));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the catalog.');
    }
  }, [db]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedItem = items.find((entry) => entry.id === itemId);

  const switchMode = (next: Mode) => {
    setMode(next);
    setPrice('');
    setReason('');
    setError(null);
  };

  const save = useCallback(async () => {
    if (!quotationId) return;
    setSaving(true);
    setError(null);
    try {
      const unitPrice = price.trim() ? parseCurrencyToCentavos(price) : undefined;
      if (price.trim() && unitPrice === null) throw new Error('Enter the price as an amount such as 1,250.00.');
      if (mode === 'item') {
        if (!itemId) throw new Error('Select an item.');
        const count = Number(quantity);
        if (!Number.isSafeInteger(count) || count < 1) throw new Error('Quantity must be a whole number of at least 1.');
        await addQuotationItemLine(db, quotationId, { itemId, quantity: count, unitPriceCentavos: unitPrice ?? undefined, overrideReason: reason });
      } else {
        if (!service) throw new Error('Select a service.');
        await addQuotationServiceLine(db, quotationId, { serviceId: service.id, rateCentavos: unitPrice ?? undefined, overrideReason: reason });
      }
      router.back();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not add the line.');
    } finally {
      setSaving(false);
    }
  }, [db, itemId, mode, price, quantity, quotationId, reason, service]);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text selectable style={styles.eyebrow}>ADD TO QUOTATION</Text>
      <View style={styles.tabs}>
        {(['item', 'service'] as const).map((value) => (
          <Pressable key={value} accessibilityRole="button" onPress={() => switchMode(value)} style={[styles.tab, mode === value ? styles.activeTab : null]}>
            <Text style={[styles.tabText, mode === value ? styles.activeTabText : null]}>{value === 'item' ? 'Inventory item' : 'Service'}</Text>
          </Pressable>
        ))}
      </View>

      {mode === 'item' ? (
        <>
          <ItemPicker items={items} selectedId={itemId} onSelect={setItemId} onCreated={async (id) => { await load(); setItemId(id); }} />
          {selectedItem ? (
            <View style={styles.editor}>
              <Text selectable style={styles.selectedTitle}>{selectedItem.name}</Text>
              <Text selectable style={styles.help}>List price {formatCentavos(selectedItem.baseSellingPriceCentavos)} per {selectedItem.unitLabel}. A customer-specific price is used automatically.</Text>
              <FormField keyboardType="number-pad" label="Quantity" onChangeText={setQuantity} value={quantity} />
              <FormField keyboardType="decimal-pad" label="Quoted unit price (optional)" onChangeText={setPrice} placeholder="Leave blank to use the resolved price" value={price} />
              {price.trim() ? <FormField label="Reason for the different price" onChangeText={setReason} value={reason} /> : null}
            </View>
          ) : null}
        </>
      ) : (
        <>
          <ServicePicker services={services} onSelect={setService} onCreated={async () => { await load(); }} />
          {service ? (
            <View style={styles.editor}>
              <Text selectable style={styles.selectedTitle}>{service.name}</Text>
              <Text selectable style={styles.help}>Catalog rate {formatCentavos(service.baseRateCentavos)}.</Text>
              <FormField keyboardType="decimal-pad" label="Quoted rate (optional)" onChangeText={setPrice} placeholder="Leave blank to use the catalog rate" value={price} />
              {price.trim() ? <FormField label="Reason for the different rate" onChangeText={setReason} value={reason} /> : null}
            </View>
          ) : null}
        </>
      )}

      {error ? <Text selectable style={styles.error}>{error}</Text> : null}
      <ActionButton disabled={saving || (mode === 'item' ? !itemId : !service)} onPress={() => void save()}>{saving ? 'Adding…' : 'Add to quotation'}</ActionButton>
      <ActionButton disabled={saving} variant="secondary" onPress={() => router.back()}>Cancel</ActionButton>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, padding: 18, paddingBottom: 44 },
  eyebrow: { color: colors.brandBlue, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  tab: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: colors.separator, borderRadius: 20, backgroundColor: colors.surface },
  activeTab: { borderColor: colors.brandBlue, backgroundColor: '#eaf2ff' },
  tabText: { color: colors.secondaryLabel, fontSize: 12, fontWeight: '800' },
  activeTabText: { color: colors.brandNavy },
  editor: { gap: 12, padding: 15, backgroundColor: '#eaf2ff', borderRadius: 16, borderCurve: 'continuous' },
  selectedTitle: { color: colors.brandNavy, fontSize: 17, fontWeight: '900' },
  help: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
  error: { color: colors.error, fontSize: 13, fontWeight: '600' },
});
