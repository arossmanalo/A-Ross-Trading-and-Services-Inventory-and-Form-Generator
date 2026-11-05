import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { formatCentavos } from '@/domain/money';
import { getCustomerDetail } from '@/features/customers/customer-repository';
import type { CustomerEquipment } from '@/features/customers/customer-types';
import { convertQuotation } from '@/features/quotations/quotation-conversion';
import { getQuotation } from '@/features/quotations/quotation-repository';
import type { QuotationDetail } from '@/features/quotations/quotation-types';
import { colors } from '@/theme/colors';

type Target = 'repair' | 'delivery';

export default function ConvertQuotationScreen() {
  const { quotationId } = useLocalSearchParams<{ quotationId: string }>();
  const db = useSQLiteContext();
  const [quotation, setQuotation] = useState<QuotationDetail | null>(null);
  const [machines, setMachines] = useState<CustomerEquipment[]>([]);
  const [target, setTarget] = useState<Target | null>(null);
  const [equipmentIds, setEquipmentIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!quotationId) return;
    void (async () => {
      try {
        const result = await getQuotation(db, quotationId);
        if (!result) throw new Error('Quotation was not found.');
        setQuotation(result);
        const customer = await getCustomerDetail(db, result.customerId);
        setMachines((customer?.equipment ?? []).filter((machine) => machine.active));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load the quotation.');
      }
    })();
  }, [db, quotationId]);

  const toggleMachine = (id: string) => setEquipmentIds((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));

  const convert = useCallback(async () => {
    if (!quotationId || !target) return;
    setSaving(true);
    setError(null);
    try {
      const result = await convertQuotation(db, quotationId, target === 'repair' ? { kind: 'repair', equipmentIds } : { kind: 'delivery' });
      if (result.kind === 'repair') router.replace({ pathname: '/service-reports/[report-id]', params: { 'report-id': result.documentId } });
      else router.replace({ pathname: '/deliveries/[delivery-id]', params: { 'delivery-id': result.documentId } });
    } catch (convertError) {
      setError(convertError instanceof Error ? convertError.message : 'Could not convert the quotation.');
    } finally {
      setSaving(false);
    }
  }, [db, equipmentIds, quotationId, target]);

  const hasItems = quotation?.lines.some((line) => line.lineType === 'item') ?? false;
  const ready = target === 'delivery' ? hasItems : target === 'repair' ? equipmentIds.length > 0 : false;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.intro}>
        <Text selectable style={styles.eyebrow}>CONVERT {quotation?.qtNumber ?? 'QUOTATION'}</Text>
        <Text selectable style={styles.introText}>
          Is this quotation for a repair or a delivery? Either way a linked Billing Statement draft is created automatically with the quoted prices, and the quotation is marked converted.
        </Text>
        {quotation ? <Text selectable style={styles.introText}>{quotation.customerName} · {formatCentavos(quotation.totalCentavos)}</Text> : null}
      </View>

      <Choice title="For repair" body="Creates a CSR draft for the machines you pick, with the quoted items and services, and its Billing Statement." selected={target === 'repair'} onPress={() => setTarget('repair')} />
      <Choice title="For delivery" body={hasItems ? 'Creates a Delivery form with the quoted items, and its Billing Statement. Quoted services go on the statement.' : 'A delivery needs at least one inventory item, and this quotation lists only services.'} selected={target === 'delivery'} disabled={!hasItems} onPress={() => setTarget('delivery')} />

      {target === 'repair' ? (
        <View style={styles.machines}>
          <Text selectable style={styles.sectionTitle}>Machines for the repair</Text>
          <Text selectable style={styles.help}>Quoted services are priced on the first machine you pick.</Text>
          {machines.length ? machines.map((machine) => (
            <Choice
              key={machine.id}
              title={[machine.machineType, machine.model, machine.nicknameOrLocation].filter(Boolean).join(' · ')}
              body={machine.serialNumber ? `Serial ${machine.serialNumber}` : 'No serial number'}
              selected={equipmentIds.includes(machine.id)}
              onPress={() => toggleMachine(machine.id)}
            />
          )) : <Text selectable style={styles.help}>This customer has no active machines. Add one on the customer screen first.</Text>}
        </View>
      ) : null}

      {error ? <Text selectable style={styles.error}>{error}</Text> : null}
      <ActionButton disabled={saving || !ready} onPress={() => void convert()}>{saving ? 'Converting…' : 'Convert quotation'}</ActionButton>
      <ActionButton disabled={saving} variant="secondary" onPress={() => router.back()}>Cancel</ActionButton>
    </ScrollView>
  );
}

function Choice({ title, body, selected, disabled = false, onPress }: { title: string; body: string; selected: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={[styles.choice, selected ? styles.selected : null, disabled ? styles.disabled : null]}>
      <Text selectable style={[styles.choiceTitle, selected ? styles.selectedText : null]}>{title}</Text>
      <Text selectable style={styles.help}>{body}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, padding: 18, paddingBottom: 44 },
  intro: { gap: 6, padding: 16, backgroundColor: '#eaf2ff', borderRadius: 16, borderCurve: 'continuous' },
  eyebrow: { color: colors.brandBlue, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  introText: { color: colors.brandNavy, fontSize: 14, lineHeight: 20 },
  choice: { gap: 4, padding: 15, borderWidth: 1, borderColor: colors.separator, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.surface },
  selected: { borderColor: colors.brandBlue, backgroundColor: '#eaf2ff' },
  disabled: { opacity: 0.5 },
  choiceTitle: { color: colors.label, fontSize: 15, fontWeight: '800' },
  selectedText: { color: colors.brandNavy },
  machines: { gap: 10 },
  sectionTitle: { color: colors.label, fontSize: 16, fontWeight: '900' },
  help: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
  error: { color: colors.error, fontSize: 13, fontWeight: '600' },
});
