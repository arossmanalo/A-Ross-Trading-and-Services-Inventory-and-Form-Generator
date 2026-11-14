import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';

import { ActionButton } from '@/components/action-button';
import { DateField } from '@/components/date-field';
import { FormField } from '@/components/form-field';
import { Notice } from '@/components/notice';
import { SheetBody, SheetSection } from '@/components/sheet-body';
import { getLocalBusinessDate } from '@/domain/business-date';
import { CustomerPicker } from '@/features/customers/customer-picker';
import { listCustomers } from '@/features/customers/customer-repository';
import type { CustomerSummary } from '@/features/customers/customer-types';
import { createDeliveryDraft } from '@/features/deliveries/delivery-repository';

export default function NewDeliveryScreen() {
  const db = useSQLiteContext();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [businessDate, setBusinessDate] = useState(getLocalBusinessDate());
  const [deliveredBy, setDeliveredBy] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadCustomers = useCallback(async () => {
    try {
      const rows = await listCustomers(db);
      setCustomers(rows.filter((customer) => customer.active));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load customers.');
    }
  }, [db]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const handleCustomerCreated = useCallback(async (newId: string) => {
    await loadCustomers();
    setCustomerId(newId);
  }, [loadCustomers]);

  const create = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const id = await createDeliveryDraft(db, { customerId, businessDate, deliveredBy, receivedBy });
      router.replace({ pathname: '/deliveries/[delivery-id]', params: { 'delivery-id': id } });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the delivery.');
    } finally {
      setSaving(false);
    }
  }, [businessDate, customerId, db, deliveredBy, receivedBy]);

  return (
    <SheetBody
      error={error}
      actions={
        <>
          <ActionButton disabled={saving || !customerId} onPress={() => void create()}>
            {saving ? 'Creating…' : 'Create draft'}
          </ActionButton>
          <ActionButton disabled={saving} variant="secondary" onPress={() => router.back()}>Cancel</ActionButton>
        </>
      }
    >
      <Notice label="Unnumbered draft">
        Pick the inventory items to deliver next. The DF number is allocated and stock is deducted only when you
        finalize the delivery.
      </Notice>
      <SheetSection title="Customer">
        <CustomerPicker customers={customers} selectedId={customerId} onSelect={setCustomerId} onCreated={handleCustomerCreated} />
      </SheetSection>
      <SheetSection title="Delivery">
        <DateField label="Delivery date" value={businessDate} onChange={setBusinessDate} />
        <FormField
          autoCapitalize="words"
          label="Delivered by (optional)"
          onChangeText={setDeliveredBy}
          placeholder="Driver or staff name"
          value={deliveredBy}
        />
        <FormField
          autoCapitalize="words"
          label="Received by (optional)"
          onChangeText={setReceivedBy}
          placeholder="Name of the person receiving"
          value={receivedBy}
        />
      </SheetSection>
    </SheetBody>
  );
}
