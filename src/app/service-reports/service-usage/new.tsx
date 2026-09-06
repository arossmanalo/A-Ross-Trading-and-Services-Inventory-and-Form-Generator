import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { formatCentavos, parseCurrencyToCentavos } from '@/domain/money';
import { addReportServiceUsage } from '@/features/service-reports/service-report-repository';
import { listServices } from '@/features/services/service-repository';
import type { ServiceCatalogEntry } from '@/features/services/service-types';
import { colors } from '@/theme/colors';

export default function NewReportServiceUsageScreen() {
  const { reportId } = useLocalSearchParams<{ reportId: string }>();
  const db = useSQLiteContext();
  const [services, setServices] = useState<ServiceCatalogEntry[]>([]);
  const [selectedService, setSelectedService] = useState<ServiceCatalogEntry | null>(null);
  const [rate, setRate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadServices = useCallback(async () => {
    try {
      const rows = await listServices(db);
      setServices(rows.filter((service) => service.active));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load services.');
    }
  }, [db]);

  useFocusEffect(useCallback(() => { void loadServices(); }, [loadServices]));

  const save = useCallback(async () => {
    if (!reportId || !selectedService) {
      setError('Select a service.');
      return;
    }
    let overrideRate: number | undefined;
    try {
      if (rate.trim()) overrideRate = parseCurrencyToCentavos(rate);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Enter a valid service rate.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addReportServiceUsage(db, reportId, selectedService.id, overrideRate, reason);
      router.back();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not add service usage.');
    } finally {
      setSaving(false);
    }
  }, [db, rate, reason, reportId, selectedService]);

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      data={services}
      keyExtractor={(service) => service.id}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => { setSelectedService(item); setRate(''); setReason(''); setError(null); }}
          style={[styles.itemRow, selectedService?.id === item.id ? styles.selectedRow : null]}
        >
          <View style={styles.itemCopy}>
            <Text selectable style={styles.itemName}>{item.name}</Text>
            <Text selectable style={styles.itemMeta}>{formatCentavos(item.baseRateCentavos)} · quantity 1{item.description ? ` · ${item.description}` : ''}</Text>
          </View>
          <Text selectable style={styles.selectLabel}>{selectedService?.id === item.id ? 'SELECTED' : 'SELECT'}</Text>
        </Pressable>
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text selectable style={styles.eyebrow}>SERVICE USED</Text>
          <Text selectable style={styles.help}>Services use quantity one. Leave the custom rate blank to use the catalog rate.</Text>
          <ActionButton compact onPress={() => router.push({ pathname: '/services/new', params: { returnTo: 'service-report-service-usage' } })} variant="secondary">Add new service</ActionButton>
          {selectedService ? (
            <View style={styles.editor}>
              <Text selectable style={styles.selectedName}>{selectedService.name}</Text>
              <Text selectable style={styles.itemMeta}>Catalog rate: {formatCentavos(selectedService.baseRateCentavos)}</Text>
              <FormField keyboardType="decimal-pad" label="Custom rate (optional)" onChangeText={setRate} placeholder="Leave blank for catalog rate" value={rate} />
              <FormField label="Override reason" onChangeText={setReason} placeholder="Required when using a different rate" value={reason} />
              <ActionButton disabled={saving} onPress={() => void save()}>{saving ? 'Adding…' : 'Add service usage'}</ActionButton>
            </View>
          ) : null}
          {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={<View style={styles.empty}><Text selectable style={styles.help}>No active services are available.</Text><ActionButton compact onPress={() => router.push({ pathname: '/services/new', params: { returnTo: 'service-report-service-usage' } })}>Add new service</ActionButton></View>}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingBottom: 44 },
  header: { gap: 12, paddingVertical: 18 },
  eyebrow: { color: colors.brandBlue, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  help: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
  editor: { gap: 12, padding: 15, backgroundColor: '#eaf2ff', borderRadius: 16, borderCurve: 'continuous' },
  selectedName: { color: colors.brandNavy, fontSize: 17, fontWeight: '900' },
  itemRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  selectedRow: { paddingHorizontal: 12, backgroundColor: '#eaf2ff', borderRadius: 14, borderCurve: 'continuous' },
  itemCopy: { flex: 1, gap: 4 },
  itemName: { color: colors.label, fontSize: 15, fontWeight: '800' },
  itemMeta: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 17 },
  selectLabel: { color: colors.brandBlue, fontSize: 9, fontWeight: '900', letterSpacing: .7 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  empty: { gap: 12, paddingVertical: 24 },
  errorText: { color: colors.error, fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
