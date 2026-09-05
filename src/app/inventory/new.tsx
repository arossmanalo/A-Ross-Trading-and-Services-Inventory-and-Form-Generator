import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { parseCurrencyToCentavos } from '@/domain/money';
import {
  createInventoryItemWithOpeningStock,
  DuplicateSkuError,
} from '@/features/inventory/inventory-repository';
import { colors } from '@/theme/colors';

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
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <View style={styles.intro}>
          <Text selectable style={styles.eyebrow}>CATALOG + OPENING MOVEMENT</Text>
          <Text selectable style={styles.introText}>
            Opening stock is saved as a Restock movement, so inventory never starts with an unexplained quantity.
          </Text>
        </View>

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
        <FormField
          label="Description (optional)"
          multiline
          onChangeText={setDescription}
          placeholder="Compatibility, size, or workshop notes"
          style={styles.multiline}
          textAlignVertical="top"
          value={description}
        />

        {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}

        <View style={styles.actions}>
          {duplicateSku ? (
            <ActionButton
              disabled={saving}
              onPress={() => void save(true)}
              variant="danger"
            >
              Save duplicate SKU anyway
            </ActionButton>
          ) : null}
          <ActionButton disabled={saving} onPress={() => void save(false)}>
            {saving ? 'Saving…' : 'Save item'}
          </ActionButton>
          <ActionButton disabled={saving} onPress={() => router.back()} variant="secondary">
            Cancel
          </ActionButton>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
  flex: {
    flex: 1,
  },
  content: {
    gap: 18,
    padding: 18,
    paddingBottom: 44,
  },
  intro: {
    gap: 6,
    padding: 16,
    backgroundColor: '#eaf2ff',
    borderRadius: 16,
    borderCurve: 'continuous',
  },
  eyebrow: {
    color: colors.brandBlue,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  introText: {
    color: colors.brandNavy,
    fontSize: 14,
    lineHeight: 20,
  },
  twoColumns: {
    flexDirection: 'row',
    gap: 12,
  },
  column: {
    flex: 1,
    minWidth: 0,
  },
  multiline: {
    minHeight: 104,
  },
  actions: {
    gap: 10,
    paddingTop: 4,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
});
