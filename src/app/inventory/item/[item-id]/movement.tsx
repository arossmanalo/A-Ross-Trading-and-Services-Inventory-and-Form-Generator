import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import {
  consumeInventoryItem,
  getInventoryItemDetail,
  restockInventoryItem,
} from '@/features/inventory/inventory-repository';
import { Notice } from '@/components/notice';
import { SheetBody } from '@/components/sheet-body';
import type { InventoryItemDetail } from '@/features/inventory/inventory-types';
import { text } from '@/theme/typography';

export default function InventoryMovementScreen() {
  const { 'item-id': itemId, movementType: rawMovementType } = useLocalSearchParams<{
    'item-id': string;
    movementType?: string;
  }>();
  const movementType = rawMovementType === 'consumption' ? 'consumption' : 'restock';
  const db = useSQLiteContext();
  const [item, setItem] = useState<InventoryItemDetail | null>(null);
  const [quantity, setQuantity] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!itemId) {
      setError('Inventory item identifier is missing.');
      return;
    }
    void getInventoryItemDetail(db, itemId)
      .then((result) => {
        if (!result) throw new Error('Inventory item was not found.');
        setItem(result);
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not load inventory item.');
      });
  }, [db, itemId]);

  const save = useCallback(async () => {
    if (!itemId) {
      setError('Inventory item identifier is missing.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const parsedQuantity = parsePositiveWholeNumber(quantity);
      const input = { itemId, quantity: parsedQuantity, description };
      if (movementType === 'restock') {
        await restockInventoryItem(db, input);
      } else {
        await consumeInventoryItem(db, input);
      }
      router.back();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not record movement.');
    } finally {
      setSaving(false);
    }
  }, [db, description, itemId, movementType, quantity]);

  const title = movementType === 'restock' ? 'Restock' : 'Consumption';

  return (
    <>
      <Stack.Screen options={{ title }} />
      <SheetBody
        error={error}
        actions={
          <>
            <ActionButton disabled={saving || !item} onPress={() => void save()}>
              {saving ? 'Recording…' : `Record ${title}`}
            </ActionButton>
            <ActionButton disabled={saving} onPress={() => router.back()} variant="secondary">
              Cancel
            </ActionButton>
          </>
        }
      >
        <Notice label={item?.name ?? 'Loading item…'}>
          <Text selectable style={[text.subhead, styles.stock]}>
            Current stock: {item?.currentStock ?? '—'} {item?.unitLabel ?? ''}
          </Text>
          {!item?.active && item ? (
            <Text selectable style={text.meta}>
              This item is inactive. Corrective Restock and Consumption remain allowed.
            </Text>
          ) : null}
        </Notice>

        <FormField
          keyboardType="number-pad"
          label={movementType === 'restock' ? 'Quantity to add' : 'Quantity to consume'}
          hint={movementType === 'restock' ? 'Enter the number of units being added to stock.' : 'Enter the number of units being consumed.'}
          onChangeText={setQuantity}
          placeholder="Enter a whole number"
          value={quantity}
        />
        <FormField
          label="Description"
          multiline
          onChangeText={setDescription}
          placeholder={movementType === 'restock' ? 'Supplier delivery or stock count' : 'Workshop use or correction'}
          style={styles.multiline}
          textAlignVertical="top"
          value={description}
        />
      </SheetBody>
    </>
  );
}

function parsePositiveWholeNumber(value: string): number {
  if (!/^\d+$/.test(value.trim())) throw new Error('Quantity must be a positive whole number.');
  const quantity = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error('Quantity must be a positive whole number.');
  }
  return quantity;
}

const styles = StyleSheet.create({
  stock: { fontVariant: ['tabular-nums'] },
  multiline: { minHeight: 96 },
});
