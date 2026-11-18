import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';

import { ActionButton } from '@/components/action-button';
import { ChoiceChips } from '@/components/choice-chips';
import { FormField } from '@/components/form-field';
import { SheetBody, SheetSection } from '@/components/sheet-body';
import { formatCentavos, parseCurrencyToCentavos } from '@/domain/money';
import { listInventoryItems } from '@/features/inventory/inventory-repository';
import { ItemPicker } from '@/features/inventory/item-picker';
import type { InventoryItemSummary } from '@/features/inventory/inventory-types';
import { addQuotationItemLine, addQuotationServiceLine } from '@/features/quotations/quotation-repository';
import { ServicePicker } from '@/features/services/service-picker';
import { listServices } from '@/features/services/service-repository';
import type { ServiceCatalogEntry } from '@/features/services/service-types';

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
    <SheetBody
      error={error}
      actions={
        <>
          <ActionButton disabled={saving || (mode === 'item' ? !itemId : !service)} onPress={() => void save()}>
            {saving ? 'Adding…' : 'Add to quotation'}
          </ActionButton>
          <ActionButton disabled={saving} variant="secondary" onPress={() => router.back()}>Cancel</ActionButton>
        </>
      }
    >
      <ChoiceChips
        label="Add"
        options={[{ value: 'item', label: 'Inventory item' }, { value: 'service', label: 'Service' }]}
        value={mode}
        onChange={switchMode}
      />

      {mode === 'item' ? (
        <>
          <ItemPicker inventoryKind="product" items={items} selectedId={itemId} onSelect={setItemId} onCreated={async (id) => { await load(); setItemId(id); }} />
          {selectedItem ? (
            <SheetSection
              title={selectedItem.name}
              hint={`List price ${formatCentavos(selectedItem.baseSellingPriceCentavos)} per ${selectedItem.unitLabel}. A customer-specific price is used automatically.`}
            >
              <FormField keyboardType="number-pad" label="Quantity" onChangeText={setQuantity} value={quantity} />
              <FormField
                keyboardType="decimal-pad"
                label="Quoted unit price (optional)"
                onChangeText={setPrice}
                placeholder="Leave blank to use the resolved price"
                value={price}
              />
              {price.trim() ? <FormField label="Reason for the different price" onChangeText={setReason} value={reason} /> : null}
            </SheetSection>
          ) : null}
        </>
      ) : (
        <>
          <ServicePicker services={services} onSelect={setService} onCreated={async () => { await load(); }} />
          {service ? (
            <SheetSection title={service.name} hint={`Catalog rate ${formatCentavos(service.baseRateCentavos)}.`}>
              <FormField
                keyboardType="decimal-pad"
                label="Quoted rate (optional)"
                onChangeText={setPrice}
                placeholder="Leave blank to use the catalog rate"
                value={price}
              />
              {price.trim() ? <FormField label="Reason for the different rate" onChangeText={setReason} value={reason} /> : null}
            </SheetSection>
          ) : null}
        </>
      )}
    </SheetBody>
  );
}
