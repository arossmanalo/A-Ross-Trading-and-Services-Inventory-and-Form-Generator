import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { getLocalBusinessDate } from '@/domain/business-date';
import { getCustomerDetail, listCustomers } from '@/features/customers/customer-repository';
import type { CustomerEquipment, CustomerSummary } from '@/features/customers/customer-types';
import { createServiceReportDraft } from '@/features/service-reports/service-report-repository';
import { colors } from '@/theme/colors';

export default function NewServiceReportScreen() {
  const { followsCsrId, customerId: initialCustomerId, equipmentId: initialEquipmentId } = useLocalSearchParams<{
    followsCsrId?: string;
    customerId?: string;
    equipmentId?: string;
  }>();
  const db = useSQLiteContext();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [equipment, setEquipment] = useState<CustomerEquipment[]>([]);
  const [customerId, setCustomerId] = useState(initialCustomerId ?? '');
  const [equipmentId, setEquipmentId] = useState(initialEquipmentId ?? '');
  const [businessDate, setBusinessDate] = useState(getLocalBusinessDate());
  const [backdateReason, setBackdateReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    void listCustomers(db)
      .then((rows) => { if (active) setCustomers(rows.filter((customer) => customer.active)); })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load customers.'));
    return () => { active = false; };
  }, [db]));

  useFocusEffect(useCallback(() => {
    if (!customerId) {
      setEquipment([]);
      setEquipmentId('');
      return;
    }
    let active = true;
    void getCustomerDetail(db, customerId)
      .then((customer) => {
        if (!active) return;
        const rows = customer?.equipment.filter((entry) => entry.active) ?? [];
        setEquipment(rows);
        if (!rows.some((entry) => entry.id === equipmentId)) setEquipmentId('');
      })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load equipment.'));
    return () => { active = false; };
  }, [customerId, db, equipmentId]));

  const createDraft = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const reportId = await createServiceReportDraft(db, {
        customerId,
        equipmentId,
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
  }, [backdateReason, businessDate, customerId, db, equipmentId, followsCsrId]);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <View style={styles.intro}>
        <Text selectable style={styles.eyebrow}>{followsCsrId ? 'FOLLOW-UP VISIT' : 'UNNUMBERED DRAFT'}</Text>
        <Text selectable style={styles.introText}>Choose one registered customer and one of their active equipment records.</Text>
      </View>
      <Text selectable style={styles.sectionTitle}>Customer</Text>
      {!customers.length ? <View style={styles.choices}><Text selectable style={styles.help}>No active customers are available. Register a customer and add their equipment before creating a CSR.</Text><ActionButton variant="secondary" onPress={() => router.push('/customers/new')}>Register customer</ActionButton></View> : null}
      <View style={styles.choices}>
        {customers.map((customer) => (
          <Choice key={customer.id} label={customer.name} selected={customer.id === customerId} onPress={() => setCustomerId(customer.id)} />
        ))}
      </View>
      {customerId ? (
        <>
          <Text selectable style={styles.sectionTitle}>Equipment</Text>
          <View style={styles.choices}>
            {equipment.map((entry) => (
              <Choice
                key={entry.id}
                label={[entry.machineType, entry.model, entry.nicknameOrLocation].filter(Boolean).join(' · ')}
                selected={entry.id === equipmentId}
                onPress={() => setEquipmentId(entry.id)}
              />
            ))}
            {!equipment.length ? <><Text selectable style={styles.help}>This customer has no active equipment.</Text><ActionButton variant="secondary" onPress={() => router.push({pathname:'/customers/equipment/new',params:{customerId}})}>Add equipment for this customer</ActionButton></> : null}
          </View>
        </>
      ) : null}
      <FormField label="Business date" onChangeText={setBusinessDate} placeholder="YYYY-MM-DD" value={businessDate} />
      {businessDate < getLocalBusinessDate() ? (
        <FormField label="Backdate reason" onChangeText={setBackdateReason} placeholder="Why this CSR uses an earlier date" value={backdateReason} />
      ) : null}
      {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
      <ActionButton disabled={saving || !customerId || !equipmentId} onPress={() => void createDraft()}>
        {saving ? 'Creating…' : 'Create draft'}
      </ActionButton>
    </ScrollView>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.choice, selected ? styles.choiceSelected : null]}>
      <Text selectable style={[styles.choiceText, selected ? styles.choiceTextSelected : null]}>{label}</Text>
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
  choiceTextSelected: { color: colors.brandNavy },
  help: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
  errorText: { color: colors.error, fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
