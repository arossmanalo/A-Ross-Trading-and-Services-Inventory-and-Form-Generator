import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { DateField } from '@/components/date-field';
import { Notice } from '@/components/notice';
import { OptionRow } from '@/components/option-row';
import { Fact } from '@/components/record-layout';
import { SheetBody, SheetSection } from '@/components/sheet-body';
import { getLocalBusinessDate } from '@/domain/business-date';
import { CustomerPicker } from '@/features/customers/customer-picker';
import { getCustomerDetail, listCustomers } from '@/features/customers/customer-repository';
import type { CustomerEquipment, CustomerSummary } from '@/features/customers/customer-types';
import { createServiceReportDraft } from '@/features/service-reports/service-report-repository';
import { spacing, text } from '@/theme/typography';

export default function NewServiceReportScreen() {
  const {
    followsCsrId,
    customerId: initialCustomerId,
    equipmentId: initialEquipmentId,
    equipmentIds: initialEquipmentIds,
  } = useLocalSearchParams<{
    followsCsrId?: string;
    customerId?: string;
    equipmentId?: string;
    /** Comma-separated machine ids, used by follow-up visits. */
    equipmentIds?: string;
  }>();
  const db = useSQLiteContext();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [equipment, setEquipment] = useState<CustomerEquipment[]>([]);
  const [customerId, setCustomerId] = useState(initialCustomerId ?? '');
  const [machineIds, setMachineIds] = useState<string[]>(
    (initialEquipmentIds ?? initialEquipmentId ?? '').split(',').filter(Boolean),
  );
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

  useFocusEffect(useCallback(() => {
    void loadCustomers();
  }, [loadCustomers]));

  // Depends only on the customer so toggling a machine never reloads or resets the selection.
  useFocusEffect(useCallback(() => {
    if (!customerId) {
      setEquipment([]);
      return;
    }
    let active = true;
    void getCustomerDetail(db, customerId)
      .then((customer) => {
        if (!active) return;
        const rows = customer?.equipment.filter((entry) => entry.active) ?? [];
        setEquipment(rows);
        setMachineIds((current) => current.filter((id) => rows.some((entry) => entry.id === id)));
      })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load equipment.'));
    return () => { active = false; };
  }, [customerId, db]));

  const selectCustomer = useCallback((nextId: string) => {
    setCustomerId(nextId);
    setMachineIds([]);
    setError(null);
  }, []);

  const handleCustomerCreated = useCallback(async (newId: string) => {
    await loadCustomers();
    selectCustomer(newId);
  }, [loadCustomers, selectCustomer]);

  const toggleMachine = useCallback((id: string) => {
    setMachineIds((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  }, []);

  const createDraft = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const reportId = await createServiceReportDraft(db, {
        customerId,
        equipmentId: machineIds[0],
        additionalEquipmentIds: machineIds.slice(1),
        businessDate,
        followsCsrId,
      });
      router.replace({ pathname: '/service-reports/[report-id]', params: { 'report-id': reportId } });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create CSR draft.');
    } finally {
      setSaving(false);
    }
  }, [businessDate, customerId, db, followsCsrId, machineIds]);

  const followUpCustomer = customers.find((customer) => customer.id === customerId);

  return (
    <SheetBody
      error={error}
      actions={
        <>
          <ActionButton disabled={saving || !customerId || machineIds.length === 0} onPress={() => void createDraft()}>
            {saving ? 'Creating…' : machineIds.length > 1 ? `Create draft for ${machineIds.length} machines` : 'Create draft'}
          </ActionButton>
          <ActionButton disabled={saving} variant="secondary" onPress={() => router.back()}>Cancel</ActionButton>
        </>
      }
    >
      <Notice label={followsCsrId ? 'Follow-up visit' : 'Unnumbered draft'}>
        Choose one registered customer and the machine or machines serviced during this visit.
      </Notice>

      <SheetSection title="Customer">
        {followsCsrId ? (
          <Fact label="A follow-up stays with the original customer.">
            {followUpCustomer?.name ?? 'Loading customer…'}
          </Fact>
        ) : (
          <CustomerPicker
            customers={customers}
            selectedId={customerId}
            onSelect={selectCustomer}
            onCreated={handleCustomerCreated}
          />
        )}
      </SheetSection>

      {customerId ? (
        <SheetSection
          title="Machines"
          hint="Tap every machine serviced on this visit. Each service is billed once per machine; item charges are not multiplied."
        >
          <View style={styles.choices}>
            {equipment.map((entry) => {
              const selected = machineIds.includes(entry.id);
              const order = machineIds.indexOf(entry.id) + 1;
              return (
                <OptionRow
                  key={entry.id}
                  kind="checkbox"
                  label={`${selected ? `${order}. ` : ''}${[entry.machineType, entry.model, entry.nicknameOrLocation].filter(Boolean).join(' · ')}`}
                  selected={selected}
                  onPress={() => toggleMachine(entry.id)}
                />
              );
            })}
            {!equipment.length ? <Text selectable style={text.meta}>This customer has no active equipment yet.</Text> : null}
          </View>
          {machineIds.length > 1 ? (
            <Text selectable style={text.bodyStrong}>
              {machineIds.length} machines selected — services on this CSR will be billed × {machineIds.length}.
            </Text>
          ) : null}
          <ActionButton
            compact
            variant="secondary"
            style={styles.addMachine}
            onPress={() => router.push({ pathname: '/customers/equipment/new', params: { customerId } })}
          >
            {equipment.length ? 'Add another machine for this customer' : 'Add equipment for this customer'}
          </ActionButton>
        </SheetSection>
      ) : null}

      <DateField label="Business date" value={businessDate} onChange={setBusinessDate} />
    </SheetBody>
  );
}

const styles = StyleSheet.create({
  choices: { gap: spacing.sm },
  addMachine: { alignSelf: 'flex-start' },
});
