import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import {
  createCustomer,
  DuplicateCustomerNameError,
} from '@/features/customers/customer-repository';
import { colors } from '@/theme/colors';

export default function NewCustomerScreen() {
  const db = useSQLiteContext();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [email, setEmail] = useState('');
  const [customerType, setCustomerType] = useState<'individual' | 'company'>('individual');
  const [memberName, setMemberName] = useState('');
  const [memberContact, setMemberContact] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [duplicateName, setDuplicateName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async (allowDuplicateName: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const customerId = await createCustomer(db, {
        name,
        address,
        contactNumber,
        email,
        customerType,
        initialMember: customerType === 'company' && memberName.trim() ? { name: memberName, contactNumber: memberContact, email: memberEmail } : undefined,
        allowDuplicateName,
      });
      router.replace({
        pathname: '/customers/[customer-id]',
        params: { 'customer-id': customerId },
      });
    } catch (saveError) {
      if (saveError instanceof DuplicateCustomerNameError) {
        setDuplicateName(saveError.customerName);
      }
      setError(saveError instanceof Error ? saveError.message : 'Could not save the customer.');
    } finally {
      setSaving(false);
    }
  }, [address, contactNumber, customerType, db, email, memberContact, memberEmail, memberName, name]);

  return (
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.intro}>
          <Text selectable style={styles.eyebrow}>CUSTOMER PROFILE</Text>
          <Text selectable style={styles.introText}>
            Name is required. Address and contact details can be completed later.
          </Text>
        </View>

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
          autoCapitalize="words"
          label="Address (optional)"
          multiline
          onChangeText={setAddress}
          placeholder="Street, barangay, city or municipality"
          style={styles.multiline}
          textAlignVertical="top"
          value={address}
        />
        <FormField
          keyboardType="phone-pad"
          label="Contact number (optional)"
          onChangeText={setContactNumber}
          placeholder="09xx xxx xxxx"
          value={contactNumber}
        />
        <FormField
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          label="Email (optional)"
          onChangeText={setEmail}
          placeholder="customer@example.com"
          value={email}
        />
        <View style={styles.typePicker}>
          <Text selectable style={styles.typeLabel}>Customer type</Text>
          <View style={styles.typeRow}>
            {(['individual', 'company'] as const).map((type) => (
              <Pressable key={type} accessibilityRole="radio" accessibilityState={{ selected: customerType === type }} onPress={() => setCustomerType(type)} style={[styles.typeOption, customerType === type ? styles.typeOptionSelected : null]}>
                <Text style={customerType === type ? styles.typeOptionTextSelected : styles.typeOptionText}>{type === 'individual' ? 'Individual' : 'Company'}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {customerType === 'company' ? <View style={styles.memberCard}>
          <Text selectable style={styles.memberTitle}>First company member (optional)</Text>
          <FormField label="Member name" onChangeText={setMemberName} placeholder="Contact person" value={memberName} />
          <FormField keyboardType="phone-pad" label="Member phone (optional)" onChangeText={setMemberContact} value={memberContact} />
          <FormField autoCapitalize="none" keyboardType="email-address" label="Member email (optional)" onChangeText={setMemberEmail} value={memberEmail} />
        </View> : null}

        {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}

        <View style={styles.actions}>
          {duplicateName ? (
            <ActionButton disabled={saving} onPress={() => void save(true)} variant="danger">
              Save duplicate name anyway
            </ActionButton>
          ) : null}
          <ActionButton disabled={saving} onPress={() => void save(false)}>
            {saving ? 'Saving…' : 'Save customer'}
          </ActionButton>
          <ActionButton disabled={saving} onPress={() => router.back()} variant="secondary">
            Cancel
          </ActionButton>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  multiline: { minHeight: 84 },
  typePicker: { gap: 8 },
  typeLabel: { color: colors.label, fontSize: 13, fontWeight: '700' },
  typeRow: { flexDirection: 'row', gap: 10 },
  typeOption: { flex: 1, padding: 13, borderWidth: 1, borderColor: colors.separator, borderRadius: 12, alignItems: 'center' },
  typeOptionSelected: { backgroundColor: '#eaf2ff', borderColor: colors.brandBlue },
  typeOptionText: { color: colors.label, fontWeight: '700' },
  typeOptionTextSelected: { color: colors.brandBlue, fontWeight: '900' },
  memberCard: { gap: 12, padding: 14, borderWidth: 1, borderColor: colors.separator, borderRadius: 16, backgroundColor: colors.surface },
  memberTitle: { color: colors.label, fontWeight: '800' },
  actions: { gap: 10, paddingTop: 4 },
  errorText: {
    color: colors.error,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
});
