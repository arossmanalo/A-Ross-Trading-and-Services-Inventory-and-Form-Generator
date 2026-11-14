import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import {
  DuplicateCustomerNameError,
  getCustomerDetail,
  updateCustomer,
} from '@/features/customers/customer-repository';
import { Notice } from '@/components/notice';
import { SheetBody, SheetSection } from '@/components/sheet-body';

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
    <SheetBody
      error={error}
      actions={
        <>
          <ActionButton disabled={saving || !loaded} onPress={() => void save(false)}>{saving ? 'Saving…' : 'Save changes'}</ActionButton>
          {duplicateName ? (
            <ActionButton disabled={saving} onPress={() => void save(true)} variant="danger">Save duplicate name anyway</ActionButton>
          ) : null}
          <ActionButton disabled={saving} onPress={() => router.back()} variant="secondary">Cancel</ActionButton>
        </>
      }
    >
      <Notice label="Edit customer">
        Changes apply to new documents. Finalized documents keep the details they were issued with.
      </Notice>
      <SheetSection title="Details">
        <FormField
          autoCapitalize="words"
          label="Customer name"
          onChangeText={(value) => { setName(value); setDuplicateName(null); }}
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
      </SheetSection>
      <SheetSection title="Contact">
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
      </SheetSection>
    </SheetBody>
  );
}

const styles = StyleSheet.create({
  multiline: { minHeight: 84 },
});
