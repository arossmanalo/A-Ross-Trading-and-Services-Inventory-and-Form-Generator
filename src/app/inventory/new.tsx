import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { Notice } from '@/components/notice';
import { SheetBody, SheetSection } from '@/components/sheet-body';
import { parseCurrencyToCentavos } from '@/domain/money';
import {
  createInventoryItemWithOpeningStock,
  DuplicateSkuError,
} from '@/features/inventory/inventory-repository';
import { spacing } from '@/theme/typography';

export default function NewInventoryItemScreen() {
  const db = useSQLiteContext();
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unitLabel, setUnitLabel] = useState('pc');
  const [sellingPrice, setSellingPrice] = useState('');
  const [openingStock, setOpeningStock] = useState('0');
  const [lowStockThreshold, setLowStockThreshold] = useState('0');
  const [description, setDescription] = useState('');
  const [openingDescription, setOpeningDescription] = useState('Opening stock');
  const [duplicateSku, setDuplicateSku] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async (allowDuplicateSku: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const parsedOpeningStock = parseWholeNumber(openingStock, 'Opening stock');
      await createInventoryItemWithOpeningStock(db, {
        name,
        sku,
        description,
        unitLabel,
        baseSellingPriceCentavos: parseCurrencyToCentavos(sellingPrice || '0'),
        lowStockThreshold: parseWholeNumber(lowStockThreshold, 'Low-stock threshold'),
        openingStock: parsedOpeningStock,
        openingStockDescription: parsedOpeningStock > 0 ? openingDescription : 'Opening stock: zero',
        allowDuplicateSku,
      });
      router.back();
    } catch (saveError) {
      if (saveError instanceof DuplicateSkuError) {
        setDuplicateSku(saveError.sku);
        setError(saveError.message);
      } else {
        setError(saveError instanceof Error ? saveError.message : 'Could not save the item.');
      }
    } finally {
      setSaving(false);
    }
  }, [db, description, lowStockThreshold, name, openingDescription, openingStock, sellingPrice, sku, unitLabel]);

  return (
    <SheetBody
      error={error}
      actions={
        <>
          <ActionButton disabled={saving} onPress={() => void save(false)}>
            {saving ? 'Saving…' : 'Save item'}
          </ActionButton>
          {duplicateSku ? (
            <ActionButton disabled={saving} onPress={() => void save(true)} variant="danger">
              Save duplicate SKU anyway
            </ActionButton>
          ) : null}
          <ActionButton disabled={saving} onPress={() => router.back()} variant="secondary">
            Cancel
          </ActionButton>
        </>
      }
    >
      <Notice label="Catalog and opening stock">
        Opening stock is saved as a Restock movement, so inventory never starts with an unexplained quantity.
      </Notice>

      <SheetSection title="Item">
        <FormField
          autoCapitalize="words"
          label="Item name"
          onChangeText={setName}
          placeholder="Bearing assembly"
          returnKeyType="next"
          value={name}
        />
        <FormField
          autoCapitalize="characters"
          label="SKU or code (optional)"
          onChangeText={(value) => {
            setSku(value);
            setDuplicateSku(null);
          }}
          placeholder="BRG-001"
          value={sku}
        />
        <View style={styles.twoColumns}>
          <FormField
            autoCapitalize="none"
            containerStyle={styles.column}
            label="Unit"
            onChangeText={setUnitLabel}
            placeholder="pc"
            value={unitLabel}
          />
          <FormField
            containerStyle={styles.column}
            keyboardType="decimal-pad"
            label="Selling price"
            onChangeText={setSellingPrice}
            placeholder="0.00"
            value={sellingPrice}
          />
        </View>
      </SheetSection>

      <SheetSection title="Stock">
        <View style={styles.twoColumns}>
          <FormField
            containerStyle={styles.column}
            keyboardType="number-pad"
            label="Opening stock"
            onChangeText={setOpeningStock}
            placeholder="0"
            value={openingStock}
          />
          <FormField
            containerStyle={styles.column}
            keyboardType="number-pad"
            label="Low-stock threshold"
            onChangeText={setLowStockThreshold}
            placeholder="0"
            value={lowStockThreshold}
          />
        </View>
        {Number.parseInt(openingStock, 10) > 0 ? (
          <FormField
            label="Opening-stock description"
            onChangeText={setOpeningDescription}
            placeholder="Opening stock count"
            value={openingDescription}
          />
        ) : null}
      </SheetSection>

      <FormField
        label="Description (optional)"
        multiline
        onChangeText={setDescription}
        placeholder="Compatibility, size, or workshop notes"
        style={styles.multiline}
        textAlignVertical="top"
        value={description}
      />
    </SheetBody>
  );
}

function parseWholeNumber(value: string, label: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }
  const result = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`${label} is too large.`);
  }
  return result;
}

const styles = StyleSheet.create({
  twoColumns: { flexDirection: 'row', gap: spacing.md },
  column: { flex: 1, minWidth: 0 },
  multiline: { minHeight: 104 },
});
