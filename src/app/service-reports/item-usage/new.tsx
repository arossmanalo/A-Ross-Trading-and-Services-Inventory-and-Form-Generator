import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { Notice } from '@/components/notice';
import { SheetBody, SheetSection } from '@/components/sheet-body';
import { ToggleRow } from '@/components/toggle-row';
import { listInventoryItems } from '@/features/inventory/inventory-repository';
import { PICKER_INVENTORIES } from '@/features/inventory/inventory-kind';
import { ItemPicker } from '@/features/inventory/item-picker';
import type { InventoryItemSummary } from '@/features/inventory/inventory-types';
import { addReportItemUsage } from '@/features/service-reports/service-report-repository';

export default function NewReportItemUsageScreen() {
  const { reportId } = useLocalSearchParams<{ reportId: string }>();
  const db = useSQLiteContext();
  const [items, setItems] = useState<InventoryItemSummary[]>([]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [controlNumber, setControlNumber] = useState('');
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
    setControlNumber('');
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
      await addReportItemUsage(db, reportId, selectedItemId, parsed, billable, controlNumber);
      router.back();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not add item usage.');
    } finally {
      setSaving(false);
    }
  }, [billable, controlNumber, db, quantity, reportId, selectedItemId]);

  return (
    <SheetBody
      error={error}
      actions={
        <>
          {selectedItemId ? (
            <ActionButton disabled={saving} onPress={() => void save()}>{saving ? 'Adding…' : 'Add item usage'}</ActionButton>
          ) : null}
          <ActionButton disabled={saving} variant="secondary" onPress={() => router.back()}>Cancel</ActionButton>
        </>
      }
    >
      <Notice label="Item used">
        Draft selection does not deduct stock. Availability is checked again at finalization.
      </Notice>
      <SheetSection title="Item">
        <ItemPicker inventoryKinds={PICKER_INVENTORIES.serviceReport} items={items} selectedId={selectedItemId} onSelect={selectItem} onCreated={handleItemCreated} />
      </SheetSection>
      {selectedItemId ? (
        <SheetSection title="Usage">
          <FormField
            keyboardType="number-pad"
            label="Quantity used"
            hint="Enter the number of units used for this CSR."
            onChangeText={setQuantity}
            placeholder="Enter a whole number"
            value={quantity}
          />
          <FormField
            autoCapitalize="characters"
            autoCorrect={false}
            label="Control number (optional)"
            hint="Leave blank if the item has no control number. You can search CSRs by it later."
            maxLength={100}
            onChangeText={setControlNumber}
            placeholder="e.g. CN-000123"
            value={controlNumber}
          />
          <ToggleRow
            title="Billable to customer"
            detail="Non-billable usage still deducts inventory."
            value={billable}
            onValueChange={setBillable}
          />
        </SheetSection>
      ) : null}
    </SheetBody>
  );
}
