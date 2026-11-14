import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { Notice } from '@/components/notice';
import { SheetBody } from '@/components/sheet-body';
import { createCustomerMember } from '@/features/customers/customer-repository';

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
    setSaving(true);
    setError(null);
    try {
      await createCustomerMember(db, { customerId, name, contactNumber, email });
      router.back();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not add the member.');
    } finally {
      setSaving(false);
    }
  }, [contactNumber, customerId, db, email, name]);

  return (
    <SheetBody
      error={error}
      actions={
        <>
          <ActionButton disabled={saving} onPress={() => void save()}>{saving ? 'Saving…' : 'Add member'}</ActionButton>
          <ActionButton disabled={saving} onPress={() => router.back()} variant="secondary">Cancel</ActionButton>
        </>
      }
    >
      <Notice>Members are available as acknowledgement choices on the company’s CSR.</Notice>
      <FormField autoCapitalize="words" label="Member name" onChangeText={setName} value={name} />
      <FormField keyboardType="phone-pad" label="Phone (optional)" onChangeText={setContactNumber} value={contactNumber} />
      <FormField autoCapitalize="none" keyboardType="email-address" label="Email (optional)" onChangeText={setEmail} value={email} />
    </SheetBody>
  );
}
