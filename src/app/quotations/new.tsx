import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { DateField } from '@/components/date-field';
import { getLocalBusinessDate } from '@/domain/business-date';
import { defaultValidUntil } from '@/domain/quotation';
import { CustomerPicker } from '@/features/customers/customer-picker';
import { listCustomers } from '@/features/customers/customer-repository';
import type { CustomerSummary } from '@/features/customers/customer-types';
import { createQuotationDraft } from '@/features/quotations/quotation-repository';
import { colors } from '@/theme/colors';

export default function NewQuotationScreen() {
  const db = useSQLiteContext();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [businessDate, setBusinessDate] = useState(getLocalBusinessDate());
  const [validUntil, setValidUntil] = useState(defaultValidUntil(getLocalBusinessDate()));
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

  const changeDate = (value: string) => {
    setBusinessDate(value);
    // Keep the default 30-day validity following the date until the user picks their own.
    setValidUntil((current) => (current === defaultValidUntil(businessDate) ? defaultValidUntil(value) : current));
  };

  const create = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const id = await createQuotationDraft(db, { customerId, businessDate, validUntil });
      router.replace({ pathname: '/quotations/[quotation-id]', params: { 'quotation-id': id } });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the quotation.');
    } finally {
      setSaving(false);
    }
  }, [businessDate, customerId, db, validUntil]);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.intro}>
        <Text selectable style={styles.eyebrow}>UNNUMBERED DRAFT</Text>
        <Text selectable style={styles.introText}>
          A quotation gets its QT number when you finalize it. Add the items and services next. Nothing is deducted from stock and no payment is recorded.
        </Text>
      </View>
      <Text selectable style={styles.title}>Customer</Text>
      <CustomerPicker customers={customers} selectedId={customerId} onSelect={setCustomerId} onCreated={handleCustomerCreated} />
      <DateField label="Quotation date" value={businessDate} onChange={changeDate} />
      <DateField label="Valid until" value={validUntil} minDate={businessDate} allowFuture onChange={setValidUntil} hint="Defaults to 30 days after the quotation date." />
      {error ? <Text selectable style={styles.error}>{error}</Text> : null}
      <ActionButton disabled={saving || !customerId} onPress={() => void create()}>
        {saving ? 'Creating…' : 'Create draft'}
      </ActionButton>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, padding: 18, paddingBottom: 44 },
  intro: { gap: 6, padding: 16, backgroundColor: '#eaf2ff', borderRadius: 16, borderCurve: 'continuous' },
  eyebrow: { color: colors.brandBlue, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  introText: { color: colors.brandNavy, fontSize: 14, lineHeight: 20 },
  title: { color: colors.label, fontSize: 16, fontWeight: '900' },
  error: { color: colors.error, fontSize: 13, fontWeight: '600' },
});
