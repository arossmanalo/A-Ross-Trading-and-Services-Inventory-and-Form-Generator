import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { DateField } from '@/components/date-field';
import { getLocalBusinessDate } from '@/domain/business-date';
import { createBillingStatementDraft, listCsrsForBilling, listDeliveriesForBilling } from '@/features/billing-statements/billing-statement-repository';
import { CustomerPicker } from '@/features/customers/customer-picker';
import { listCustomers } from '@/features/customers/customer-repository';
import type { CustomerSummary } from '@/features/customers/customer-types';
import { colors } from '@/theme/colors';

type CsrChoice = {
  id: string;
  csrNumber: string | null;
  businessDate: string;
  documentState: 'draft' | 'finalized';
  availableLineCount: number;
};

type DeliveryChoice = {
  id: string;
  dfNumber: string | null;
  businessDate: string;
  documentState: 'draft' | 'finalized';
  lineCount: number;
};

export default function NewBillingStatementScreen() {
  const db = useSQLiteContext();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [csrs, setCsrs] = useState<CsrChoice[]>([]);
  const [csrId, setCsrId] = useState('');
  const [deliveries, setDeliveries] = useState<DeliveryChoice[]>([]);
  const [deliveryId, setDeliveryId] = useState('');
  const [businessDate, setBusinessDate] = useState(getLocalBusinessDate());
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

  useEffect(() => {
    setCsrId('');
    setDeliveryId('');
    if (!customerId) {
      setCsrs([]);
      setDeliveries([]);
      return;
    }
    void listDeliveriesForBilling(db, customerId)
      .then(setDeliveries)
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load deliveries.'));
    void listCsrsForBilling(db, customerId)
      .then(setCsrs)
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load CSRs.'));
  }, [customerId, db]);

  const create = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const id = await createBillingStatementDraft(db, {
        customerId,
        serviceReportId: csrId || undefined,
        deliveryId: deliveryId || undefined,
        businessDate,
      });
      router.replace({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': id } });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the draft.');
    } finally {
      setSaving(false);
    }
  }, [businessDate, csrId, customerId, db, deliveryId]);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.intro}>
        <Text selectable style={styles.eyebrow}>UNNUMBERED DRAFT</Text>
        <Text selectable style={styles.introText}>
          Link a CSR to include its available billable items and services. A linked CSR draft can be prepared now, but must be finalized before its Billing Statement.
        </Text>
      </View>
      <Text selectable style={styles.title}>Customer</Text>
      <CustomerPicker customers={customers} selectedId={customerId} onSelect={setCustomerId} onCreated={handleCustomerCreated} />
      {customerId ? (
        <>
          <Text selectable style={styles.title}>Optional CSR</Text>
          <Choice label="No linked CSR" selected={!csrId} onPress={() => setCsrId('')} />
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.csrList} contentContainerStyle={styles.choices}>
            {csrs.map((csr) => (
              <Choice
                key={csr.id}
                label={csr.documentState === 'draft'
                  ? `Draft CSR · ${csr.businessDate} · ${csr.availableLineCount} item/service charge(s) will be included`
                  : `${csr.csrNumber} · ${csr.businessDate} · ${csr.availableLineCount} unbilled item/service charge(s) will be included`}
                selected={csr.id === csrId}
                onPress={() => { setCsrId(csr.id); setDeliveryId(''); }}
              />
            ))}
          </ScrollView>
          {deliveries.length ? (
            <>
              <Text selectable style={styles.title}>Or a delivery</Text>
              <Text selectable style={styles.help}>A statement bills a CSR or a delivery, not both. Delivered items are billed as delivered and are not deducted from stock again.</Text>
              <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.csrList} contentContainerStyle={styles.choices}>
                {deliveries.map((delivery) => (
                  <Choice
                    key={delivery.id}
                    label={`${delivery.documentState === 'draft' ? 'Draft delivery' : delivery.dfNumber} · ${delivery.businessDate} · ${delivery.lineCount} item(s) will be billed`}
                    selected={delivery.id === deliveryId}
                    onPress={() => { setDeliveryId(delivery.id === deliveryId ? '' : delivery.id); setCsrId(''); }}
                  />
                ))}
              </ScrollView>
            </>
          ) : null}
        </>
      ) : null}
      <DateField label="Business date" value={businessDate} onChange={setBusinessDate} />
      {error ? <Text selectable style={styles.error}>{error}</Text> : null}
      <ActionButton disabled={saving || !customerId} onPress={() => void create()}>
        {saving ? 'Creating…' : 'Create draft'}
      </ActionButton>
    </ScrollView>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.choice, selected && styles.selected]}>
      <Text selectable style={[styles.choiceText, selected && styles.selectedText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, padding: 18, paddingBottom: 44 },
  intro: { gap: 6, padding: 16, backgroundColor: '#eaf2ff', borderRadius: 16, borderCurve: 'continuous' },
  eyebrow: { color: colors.brandBlue, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  introText: { color: colors.brandNavy, fontSize: 14, lineHeight: 20 },
  title: { color: colors.label, fontSize: 16, fontWeight: '900' },
  help: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
  csrList: { maxHeight: 260 },
  choices: { gap: 8 },
  choice: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 15, borderWidth: 1, borderColor: colors.separator, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.surface },
  selected: { borderColor: colors.brandBlue, backgroundColor: '#eaf2ff' },
  choiceText: { color: colors.label, fontSize: 14, fontWeight: '700' },
  selectedText: { color: colors.brandNavy },
  error: { color: colors.error, fontSize: 13, fontWeight: '600' },
});
