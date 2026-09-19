import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { createCustomerMember } from '@/features/customers/customer-repository';
import { colors } from '@/theme/colors';

export default function NewCustomerMemberScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const db = useSQLiteContext();
  const [name, setName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = useCallback(async () => {
    if (!customerId) return;
    setSaving(true); setError(null);
    try { await createCustomerMember(db, { customerId, name, contactNumber, email }); router.back(); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Could not add the member.'); }
    finally { setSaving(false); }
  }, [contactNumber, customerId, db, email, name]);
  return <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
    <Stack.Screen options={{ title: 'Add company member' }} />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text selectable style={styles.intro}>Members are available as acknowledgement choices on the company’s CSR.</Text>
      <FormField autoCapitalize="words" label="Member name" onChangeText={setName} value={name} />
      <FormField keyboardType="phone-pad" label="Phone (optional)" onChangeText={setContactNumber} value={contactNumber} />
      <FormField autoCapitalize="none" keyboardType="email-address" label="Email (optional)" onChangeText={setEmail} value={email} />
      {error ? <Text selectable style={styles.error}>{error}</Text> : null}
      <ActionButton disabled={saving} onPress={() => void save()}>{saving ? 'Saving…' : 'Add member'}</ActionButton>
      <ActionButton disabled={saving} onPress={() => router.back()} variant="secondary">Cancel</ActionButton>
    </ScrollView>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({ flex: { flex: 1 }, content: { gap: 16, padding: 18, paddingBottom: 44 }, intro: { color: colors.secondaryLabel, lineHeight: 20 }, error: { color: colors.error, fontWeight: '600' } });
