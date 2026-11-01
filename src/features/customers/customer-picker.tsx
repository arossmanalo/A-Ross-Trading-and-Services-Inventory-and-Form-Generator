import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { filterCustomersForSelection } from '@/domain/customer';
import { createCustomer, DuplicateCustomerNameError } from '@/features/customers/customer-repository';
import type { CustomerSummary, CustomerType } from '@/features/customers/customer-types';
import { colors } from '@/theme/colors';

/** Results beyond this are hidden so a very large customer list never floods the screen. */
const MAX_VISIBLE_RESULTS = 100;

type CustomerPickerProps = {
  customers: CustomerSummary[];
  selectedId: string;
  onSelect: (customerId: string) => void;
  /** Called after quick add. The parent should reload its customers and then select the new one. */
  onCreated: (customerId: string) => Promise<void> | void;
};

export function CustomerPicker({ customers, selectedId, onSelect, onCreated }: CustomerPickerProps) {
  const db = useSQLiteContext();
  const [query, setQuery] = useState('');
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [address, setAddress] = useState('');
  const [customerType, setCustomerType] = useState<CustomerType>('individual');
  const [duplicateName, setDuplicateName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const matches = useMemo(() => filterCustomersForSelection(customers, query), [customers, query]);
  const visible = matches.slice(0, MAX_VISIBLE_RESULTS);
  const selected = customers.find((customer) => customer.id === selectedId);

  const openQuickAdd = useCallback(() => {
    setName(query.trim());
    setError(null);
    setDuplicateName(null);
    setQuickAddOpen(true);
  }, [query]);

  const closeQuickAdd = useCallback(() => {
    setQuickAddOpen(false);
    setError(null);
    setDuplicateName(null);
  }, []);

  const save = useCallback(async (allowDuplicateName: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const customerId = await createCustomer(db, {
        name,
        contactNumber,
        address,
        customerType,
        allowDuplicateName,
      });
      setQuery('');
      setName('');
      setContactNumber('');
      setAddress('');
      setCustomerType('individual');
      setQuickAddOpen(false);
      setDuplicateName(null);
      await onCreated(customerId);
    } catch (saveError) {
      if (saveError instanceof DuplicateCustomerNameError) setDuplicateName(saveError.customerName);
      setError(saveError instanceof Error ? saveError.message : 'Could not save the customer.');
    } finally {
      setSaving(false);
    }
  }, [address, contactNumber, customerType, db, name, onCreated]);

  if (selected) {
    return (
      <View style={styles.selectedCard}>
        <View style={styles.selectedCopy}>
          <Text selectable style={styles.selectedName}>{selected.name}</Text>
          <Text selectable style={styles.rowMeta}>
            {[selected.address, selected.contactNumber].filter(Boolean).join(' · ') || 'No contact details yet'}
          </Text>
        </View>
        <ActionButton compact variant="secondary" onPress={() => onSelect('')}>Change</ActionButton>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FormField
        autoCapitalize="none"
        autoCorrect={false}
        label="Search customers"
        onChangeText={setQuery}
        placeholder="Name, address, phone, or email"
        returnKeyType="search"
        value={query}
      />
      <Text selectable style={styles.count}>
        {matches.length === 0
          ? 'No matching customers'
          : matches.length > MAX_VISIBLE_RESULTS
            ? `Showing the first ${MAX_VISIBLE_RESULTS} of ${matches.length} customers. Type more to narrow the list.`
            : `${matches.length} customer${matches.length === 1 ? '' : 's'}`}
      </Text>

      {matches.length > 0 ? (
        <ScrollView
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          testID="customer-picker-list"
        >
          {visible.map((customer, index) => (
            <Pressable
              key={customer.id}
              accessibilityRole="button"
              accessibilityLabel={`Select ${customer.name}`}
              onPress={() => onSelect(customer.id)}
              style={({ pressed }) => [styles.row, index > 0 ? styles.rowDivider : null, pressed ? styles.pressed : null]}
            >
              <Text numberOfLines={1} style={styles.rowName}>{customer.name}</Text>
              <Text numberOfLines={1} style={styles.rowMeta}>
                {[customer.address, customer.contactNumber].filter(Boolean).join(' · ') || 'No contact details yet'}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {quickAddOpen ? (
        <View style={styles.quickAdd}>
          <Text selectable style={styles.quickAddTitle}>Quick add customer</Text>
          <FormField
            autoCapitalize="words"
            label="Customer name"
            onChangeText={(value) => {
              setName(value);
              setDuplicateName(null);
            }}
            placeholder="Customer or business name"
            value={name}
          />
          <FormField
            keyboardType="phone-pad"
            label="Contact number (optional)"
            onChangeText={setContactNumber}
            placeholder="09xx xxx xxxx"
            value={contactNumber}
          />
          <FormField
            autoCapitalize="words"
            label="Address (optional)"
            onChangeText={setAddress}
            placeholder="Street, barangay, city or municipality"
            value={address}
          />
          <View style={styles.typeRow}>
            {(['individual', 'company'] as const).map((type) => (
              <Pressable
                key={type}
                accessibilityRole="radio"
                accessibilityState={{ selected: customerType === type }}
                onPress={() => setCustomerType(type)}
                style={[styles.typeOption, customerType === type ? styles.typeOptionSelected : null]}
              >
                <Text style={customerType === type ? styles.typeTextSelected : styles.typeText}>
                  {type === 'individual' ? 'Individual' : 'Company'}
                </Text>
              </Pressable>
            ))}
          </View>
          {error ? <Text selectable style={styles.error}>{error}</Text> : null}
          {duplicateName ? (
            <ActionButton disabled={saving} variant="danger" onPress={() => void save(true)}>
              Save duplicate name anyway
            </ActionButton>
          ) : null}
          <ActionButton disabled={saving || !name.trim()} onPress={() => void save(false)}>
            {saving ? 'Saving…' : 'Save and select customer'}
          </ActionButton>
          <ActionButton disabled={saving} variant="secondary" onPress={closeQuickAdd}>Cancel</ActionButton>
        </View>
      ) : (
        <ActionButton variant="secondary" onPress={openQuickAdd}>
          {query.trim() && matches.length === 0 ? `Add “${query.trim()}” as a new customer` : 'Quick add a new customer'}
        </ActionButton>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  count: { color: colors.secondaryLabel, fontSize: 12 },
  list: {
    maxHeight: 280,
    borderWidth: 1,
    borderColor: colors.separator,
    borderCurve: 'continuous',
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  row: { minHeight: 56, justifyContent: 'center', gap: 2, paddingHorizontal: 14, paddingVertical: 10 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowName: { color: colors.label, fontSize: 15, fontWeight: '700' },
  rowMeta: { color: colors.secondaryLabel, fontSize: 12 },
  pressed: { opacity: 0.72 },
  selectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.brandBlue,
    borderCurve: 'continuous',
    borderRadius: 14,
    backgroundColor: '#eaf2ff',
  },
  selectedCopy: { flex: 1, gap: 3 },
  selectedName: { color: colors.brandNavy, fontSize: 16, fontWeight: '800' },
  quickAdd: {
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.brandBlue,
    borderCurve: 'continuous',
    borderRadius: 14,
    backgroundColor: '#eaf2ff',
  },
  quickAddTitle: { color: colors.brandNavy, fontSize: 15, fontWeight: '800' },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeOption: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.separator,
    borderCurve: 'continuous',
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  typeOptionSelected: { borderColor: colors.brandBlue, backgroundColor: '#ffffff' },
  typeText: { color: colors.secondaryLabel, fontWeight: '700' },
  typeTextSelected: { color: colors.brandNavy, fontWeight: '800' },
  error: { color: colors.error, fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
