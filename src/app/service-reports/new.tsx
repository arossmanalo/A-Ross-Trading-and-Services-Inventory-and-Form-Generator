import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { getLocalBusinessDate } from '@/domain/business-date';
import { CustomerPicker } from '@/features/customers/customer-picker';
import { getCustomerDetail, listCustomers } from '@/features/customers/customer-repository';
import type { CustomerEquipment, CustomerSummary } from '@/features/customers/customer-types';
import { createServiceReportDraft } from '@/features/service-reports/service-report-repository';
import { colors } from '@/theme/colors';

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
  const [backdateReason, setBackdateReason] = useState('');
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
        backdateReason,
        followsCsrId,
      });
      router.replace({ pathname: '/service-reports/[report-id]', params: { 'report-id': reportId } });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create CSR draft.');
    } finally {
      setSaving(false);
    }
  }, [backdateReason, businessDate, customerId, db, followsCsrId, machineIds]);

  const followUpCustomer = customers.find((customer) => customer.id === customerId);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.intro}>
        <Text selectable style={styles.eyebrow}>{followsCsrId ? 'FOLLOW-UP VISIT' : 'UNNUMBERED DRAFT'}</Text>
        <Text selectable style={styles.introText}>Choose one registered customer and the machine or machines serviced during this visit.</Text>
      </View>

      <Text selectable style={styles.sectionTitle}>Customer</Text>
      {followsCsrId ? (
        <View style={styles.lockedCustomer}>
          <Text selectable style={styles.choiceTextSelected}>{followUpCustomer?.name ?? 'Loading customer…'}</Text>
          <Text selectable style={styles.help}>A follow-up stays with the original customer.</Text>
        </View>
      ) : (
        <CustomerPicker
          customers={customers}
          selectedId={customerId}
          onSelect={selectCustomer}
          onCreated={handleCustomerCreated}
        />
      )}

      {customerId ? (
        <>
          <Text selectable style={styles.sectionTitle}>Machines</Text>
          <Text selectable style={styles.help}>
            Tap every machine serviced on this visit. Each service is billed once per machine; item charges are not multiplied.
          </Text>
          <View style={styles.choices}>
            {equipment.map((entry) => {
              const selected = machineIds.includes(entry.id);
              const order = machineIds.indexOf(entry.id) + 1;
              return (
                <Choice
                  key={entry.id}
                  label={`${selected ? `${order}. ` : ''}${[entry.machineType, entry.model, entry.nicknameOrLocation].filter(Boolean).join(' · ')}`}
                  selected={selected}
                  onPress={() => toggleMachine(entry.id)}
                />
              );
            })}
            {!equipment.length ? <Text selectable style={styles.help}>This customer has no active equipment yet.</Text> : null}
            <ActionButton variant="secondary" onPress={() => router.push({ pathname: '/customers/equipment/new', params: { customerId } })}>
              {equipment.length ? 'Add another machine for this customer' : 'Add equipment for this customer'}
            </ActionButton>
          </View>
          {machineIds.length > 1 ? (
            <Text selectable style={styles.multiNotice}>
              {machineIds.length} machines selected — services on this CSR will be billed × {machineIds.length}.
            </Text>
          ) : null}
        </>
      ) : null}

      <FormField label="Business date" onChangeText={setBusinessDate} placeholder="YYYY-MM-DD" value={businessDate} />
      {businessDate < getLocalBusinessDate() ? (
        <FormField label="Backdate reason" onChangeText={setBackdateReason} placeholder="Why this CSR uses an earlier date" value={backdateReason} />
      ) : null}
      {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
      <ActionButton disabled={saving || !customerId || machineIds.length === 0} onPress={() => void createDraft()}>
        {saving ? 'Creating…' : machineIds.length > 1 ? `Create draft for ${machineIds.length} machines` : 'Create draft'}
      </ActionButton>
    </ScrollView>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.choice, selected ? styles.choiceSelected : null]}
    >
      <Text selectable style={[styles.choiceText, selected ? styles.choiceTextSelected : null]}>
        {selected ? '✓ ' : ''}{label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, padding: 18, paddingBottom: 44 },
  intro: { gap: 6, padding: 16, backgroundColor: '#eaf2ff', borderRadius: 16, borderCurve: 'continuous' },
  eyebrow: { color: colors.brandBlue, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  introText: { color: colors.brandNavy, fontSize: 14, lineHeight: 20 },
  sectionTitle: { color: colors.label, fontSize: 16, fontWeight: '900' },
  choices: { gap: 8 },
  choice: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 15, borderWidth: 1, borderColor: colors.separator, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.surface },
  choiceSelected: { borderColor: colors.brandBlue, backgroundColor: '#eaf2ff' },
  choiceText: { color: colors.label, fontSize: 14, fontWeight: '700' },
  choiceTextSelected: { color: colors.brandNavy, fontWeight: '800' },
  lockedCustomer: { gap: 4, padding: 14, borderWidth: 1, borderColor: colors.brandBlue, borderRadius: 14, borderCurve: 'continuous', backgroundColor: '#eaf2ff' },
  multiNotice: { color: colors.brandNavy, fontSize: 13, fontWeight: '700' },
  help: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
  errorText: { color: colors.error, fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
