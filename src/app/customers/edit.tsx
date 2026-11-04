import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import {
  DuplicateCustomerNameError,
  getCustomerDetail,
  updateCustomer,
} from '@/features/customers/customer-repository';
import { colors } from '@/theme/colors';

export default function EditCustomerScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const db = useSQLiteContext();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [email, setEmail] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [duplicateName, setDuplicateName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    if (!customerId) return undefined;
    void getCustomerDetail(db, customerId).then((customer) => {
      if (!active) return;
      if (!customer) { setError('Customer was not found.'); return; }
      setName(customer.name);
      setAddress(customer.address);
      setContactNumber(customer.contactNumber);
      setEmail(customer.email);
      setLoaded(true);
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load the customer.');
    });
    return () => { active = false; };
  }, [customerId, db]);

  const save = useCallback(async (allowDuplicateName: boolean) => {
    if (!customerId) return;
    setSaving(true);
    setError(null);
    try {
      await updateCustomer(db, { customerId, name, address, contactNumber, email, allowDuplicateName });
      router.back();
    } catch (saveError) {
      if (saveError instanceof DuplicateCustomerNameError) setDuplicateName(saveError.customerName);
      setError(saveError instanceof Error ? saveError.message : 'Could not save the customer.');
    } finally {
      setSaving(false);
    }
  }, [address, contactNumber, customerId, db, email, name]);

  return (
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <Text selectable style={styles.eyebrow}>EDIT CUSTOMER</Text>
          <Text selectable style={styles.introText}>
            Changes apply to new documents. Finalized documents keep the details they were issued with.
          </Text>
        </View>
        <FormField autoCapitalize="words" label="Customer name" onChangeText={(value) => { setName(value); setDuplicateName(null); }} placeholder="Customer or business name" value={name} />
        <FormField autoCapitalize="words" label="Address (optional)" multiline onChangeText={setAddress} placeholder="Street, barangay, city or municipality" style={styles.multiline} textAlignVertical="top" value={address} />
        <FormField keyboardType="phone-pad" label="Contact number (optional)" onChangeText={setContactNumber} placeholder="09xx xxx xxxx" value={contactNumber} />
        <FormField autoCapitalize="none" autoCorrect={false} keyboardType="email-address" label="Email (optional)" onChangeText={setEmail} placeholder="customer@example.com" value={email} />
        {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
        <View style={styles.actions}>
          {duplicateName ? <ActionButton disabled={saving} onPress={() => void save(true)} variant="danger">Save duplicate name anyway</ActionButton> : null}
          <ActionButton disabled={saving || !loaded} onPress={() => void save(false)}>{saving ? 'Saving…' : 'Save changes'}</ActionButton>
          <ActionButton disabled={saving} onPress={() => router.back()} variant="secondary">Cancel</ActionButton>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { gap: 18, padding: 18, paddingBottom: 44 },
  intro: { gap: 6, padding: 16, backgroundColor: '#eaf2ff', borderRadius: 16, borderCurve: 'continuous' },
  eyebrow: { color: colors.brandBlue, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  introText: { color: colors.brandNavy, fontSize: 14, lineHeight: 20 },
  multiline: { minHeight: 84 },
  actions: { gap: 10, paddingTop: 4 },
  errorText: { color: colors.error, fontSize: 14, lineHeight: 20, fontWeight: '600' },
});
