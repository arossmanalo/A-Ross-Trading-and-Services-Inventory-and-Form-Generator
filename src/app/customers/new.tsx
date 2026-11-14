import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { ChoiceChips } from '@/components/choice-chips';
import { FormField } from '@/components/form-field';
import {
  createCustomer,
  DuplicateCustomerNameError,
} from '@/features/customers/customer-repository';
import { Notice } from '@/components/notice';
import { SheetBody, SheetSection } from '@/components/sheet-body';

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
    <SheetBody
      error={error}
      actions={
        <>
          <ActionButton disabled={saving} onPress={() => void save(false)}>
            {saving ? 'Saving…' : 'Save customer'}
          </ActionButton>
          {duplicateName ? (
            <ActionButton disabled={saving} onPress={() => void save(true)} variant="danger">
              Save duplicate name anyway
            </ActionButton>
          ) : null}
          <ActionButton disabled={saving} onPress={() => router.back()} variant="secondary">
            Cancel
          </ActionButton>
        </>
      }
    >
      <Notice label="Customer profile">
        Name is required. Address and contact details can be completed later.
      </Notice>

      <SheetSection title="Details">
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
        <ChoiceChips
          label="Customer type"
          options={CUSTOMER_TYPE_OPTIONS}
          value={customerType}
          onChange={setCustomerType}
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

      {customerType === 'company' ? (
        <SheetSection title="First company member (optional)">
          <FormField label="Member name" onChangeText={setMemberName} placeholder="Contact person" value={memberName} />
          <FormField keyboardType="phone-pad" label="Member phone (optional)" onChangeText={setMemberContact} value={memberContact} />
          <FormField
            autoCapitalize="none"
            keyboardType="email-address"
            label="Member email (optional)"
            onChangeText={setMemberEmail}
            value={memberEmail}
          />
        </SheetSection>
      ) : null}
    </SheetBody>
  );
}

const CUSTOMER_TYPE_OPTIONS = [
  { value: 'individual', label: 'Individual' },
  { value: 'company', label: 'Company' },
] as const;

const styles = StyleSheet.create({
  multiline: { minHeight: 84 },
});
