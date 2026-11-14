import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { DateField } from '@/components/date-field';
import { Notice } from '@/components/notice';
import { OptionRow } from '@/components/option-row';
import { SheetBody, SheetSection } from '@/components/sheet-body';
import { getLocalBusinessDate } from '@/domain/business-date';
import { createBillingStatementDraft, listCsrsForBilling, listDeliveriesForBilling } from '@/features/billing-statements/billing-statement-repository';
import { CustomerPicker } from '@/features/customers/customer-picker';
import { listCustomers } from '@/features/customers/customer-repository';
import type { CustomerSummary } from '@/features/customers/customer-types';
import { spacing } from '@/theme/typography';

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
        Link a CSR to include its available billable items and services. A linked CSR draft can be prepared now, but
        must be finalized before its Billing Statement.
      </Notice>
      <SheetSection title="Customer">
        <CustomerPicker customers={customers} selectedId={customerId} onSelect={setCustomerId} onCreated={handleCustomerCreated} />
      </SheetSection>
      {customerId ? (
        <SheetSection title="Link a CSR (optional)">
          <OptionRow label="No linked CSR" selected={!csrId} onPress={() => setCsrId('')} />
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.list} contentContainerStyle={styles.choices}>
            {csrs.map((csr) => (
              <OptionRow
                key={csr.id}
                label={csr.documentState === 'draft' ? `Draft CSR · ${csr.businessDate}` : `${csr.csrNumber} · ${csr.businessDate}`}
                detail={csr.documentState === 'draft'
                  ? `${csr.availableLineCount} item/service charge(s) will be included`
                  : `${csr.availableLineCount} unbilled item/service charge(s) will be included`}
                selected={csr.id === csrId}
                onPress={() => { setCsrId(csr.id); setDeliveryId(''); }}
              />
            ))}
          </ScrollView>
        </SheetSection>
      ) : null}
      {customerId && deliveries.length ? (
        <SheetSection
          title="Or a delivery"
          hint="A statement bills a CSR or a delivery, not both. Delivered items are billed as delivered and are not deducted from stock again."
        >
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.list} contentContainerStyle={styles.choices}>
            {deliveries.map((delivery) => (
              <OptionRow
                key={delivery.id}
                label={`${delivery.documentState === 'draft' ? 'Draft delivery' : delivery.dfNumber} · ${delivery.businessDate}`}
                detail={`${delivery.lineCount} item(s) will be billed`}
                selected={delivery.id === deliveryId}
                onPress={() => { setDeliveryId(delivery.id === deliveryId ? '' : delivery.id); setCsrId(''); }}
              />
            ))}
          </ScrollView>
        </SheetSection>
      ) : null}
      <DateField label="Business date" value={businessDate} onChange={setBusinessDate} />
    </SheetBody>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 260 },
  choices: { gap: spacing.sm },
});
