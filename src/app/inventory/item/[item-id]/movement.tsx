import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import {
  consumeInventoryItem,
  getInventoryItemDetail,
  restockInventoryItem,
} from '@/features/inventory/inventory-repository';
import type { InventoryItemDetail } from '@/features/inventory/inventory-types';
import { colors } from '@/theme/colors';

export default function InventoryMovementScreen() {
  const { 'item-id': itemId, movementType: rawMovementType } = useLocalSearchParams<{
    'item-id': string;
    movementType?: string;
  }>();
  const movementType = rawMovementType === 'consumption' ? 'consumption' : 'restock';
  const db = useSQLiteContext();
  const [item, setItem] = useState<InventoryItemDetail | null>(null);
  const [quantity, setQuantity] = useState('1');
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
      <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.summary, movementType === 'consumption' ? styles.consumptionSummary : null]}>
            <Text selectable style={styles.eyebrow}>{title.toUpperCase()}</Text>
            <Text selectable style={styles.itemName}>{item?.name ?? 'Loading item…'}</Text>
            <Text selectable style={styles.available}>
              Available: {item?.currentStock ?? '—'} {item?.unitLabel ?? ''}
            </Text>
            {!item?.active && item ? (
              <Text selectable style={styles.inactiveNote}>
                This item is inactive. Corrective Restock and Consumption remain allowed.
              </Text>
            ) : null}
          </View>

          <FormField
            keyboardType="number-pad"
            label="Quantity"
            onChangeText={setQuantity}
            placeholder="1"
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

          {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}

          <View style={styles.actions}>
            <ActionButton disabled={saving || !item} onPress={() => void save()}>
              {saving ? 'Recording…' : `Record ${title}`}
            </ActionButton>
            <ActionButton disabled={saving} onPress={() => router.back()} variant="secondary">
              Cancel
            </ActionButton>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
  flex: { flex: 1 },
  content: { gap: 18, padding: 18, paddingBottom: 44 },
  summary: {
    gap: 5,
    padding: 17,
    backgroundColor: '#eaf7ee',
    borderRadius: 17,
    borderCurve: 'continuous',
  },
  consumptionSummary: { backgroundColor: '#fff3e8' },
  eyebrow: { color: colors.brandBlue, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  itemName: { color: colors.label, fontSize: 20, fontWeight: '900' },
  available: { color: colors.secondaryLabel, fontSize: 14, fontVariant: ['tabular-nums'] },
  inactiveNote: { color: colors.warning, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  multiline: { minHeight: 96 },
  actions: { gap: 10, paddingTop: 4 },
  errorText: { color: colors.error, fontSize: 14, lineHeight: 20, fontWeight: '600' },
});
