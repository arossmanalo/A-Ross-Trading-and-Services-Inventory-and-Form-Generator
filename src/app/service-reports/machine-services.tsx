import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { formatCentavos, parseCurrencyToCentavos } from '@/domain/money';
import {
  addMachineService,
  getServiceReport,
  removeMachineService,
  updateMachineService,
} from '@/features/service-reports/service-report-repository';
import type { ServiceReportDetail, ServiceReportMachineService } from '@/features/service-reports/service-report-types';
import { ServicePicker } from '@/features/services/service-picker';
import { listServices } from '@/features/services/service-repository';
import type { ServiceCatalogEntry } from '@/features/services/service-types';
import { colors } from '@/theme/colors';

/** A service picked from the list below, waiting for its price on the active machine. */
type PendingService = { service: ServiceCatalogEntry };

export default function MachineServicesScreen() {
  const { reportId } = useLocalSearchParams<{ reportId: string }>();
  const db = useSQLiteContext();
  const [report, setReport] = useState<ServiceReportDetail | null>(null);
  const [catalog, setCatalog] = useState<ServiceCatalogEntry[]>([]);
  const [activeMachineId, setActiveMachineId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingService | null>(null);
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [alsoIds, setAlsoIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!reportId) return;
    try {
      const [detail, services] = await Promise.all([getServiceReport(db, reportId), listServices(db)]);
      if (!detail) throw new Error('CSR was not found.');
      setReport(detail);
      setCatalog(services.filter((service) => service.active));
      setActiveMachineId((current) => current ?? (detail.machines.length === 1 ? detail.machines[0].equipmentId : null));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the CSR.');
    }
  }, [db, reportId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const servicesByMachine = useMemo(() => {
    const grouped = new Map<string, ServiceReportMachineService[]>();
    for (const service of report?.machineServices ?? []) {
      grouped.set(service.equipmentId, [...(grouped.get(service.equipmentId) ?? []), service]);
    }
    return grouped;
  }, [report?.machineServices]);

  const activeMachine = report?.machines.find((machine) => machine.equipmentId === activeMachineId) ?? null;
  const machineLabel = (machine: { machineType: string; nicknameOrLocation: string; serialNumber: string }) =>
    [machine.machineType, machine.nicknameOrLocation || (machine.serialNumber ? `SN ${machine.serialNumber}` : '')].filter(Boolean).join(' · ');

  const resetEditor = useCallback(() => {
    setPending(null);
    setEditingId(null);
    setPrice('');
    setNote('');
    setAlsoIds([]);
  }, []);

  const chooseMachine = useCallback((equipmentId: string) => {
    setActiveMachineId(equipmentId);
    resetEditor();
    setError(null);
  }, [resetEditor]);

  const pickService = useCallback((service: ServiceCatalogEntry) => {
    if (!activeMachineId) {
      setError('Tap "Add service to this machine" on a machine panel first.');
      return;
    }
    setError(null);
    setEditingId(null);
    setPending({ service });
    setPrice(service.baseRateCentavos > 0 ? (service.baseRateCentavos / 100).toFixed(2) : '');
    setNote('');
    setAlsoIds([]);
  }, [activeMachineId]);

  const handleServiceCreated = useCallback(async (serviceId: string) => {
    const services = (await listServices(db)).filter((service) => service.active);
    setCatalog(services);
    const created = services.find((service) => service.id === serviceId);
    if (created && activeMachineId) pickService(created);
  }, [activeMachineId, db, pickService]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      resetEditor();
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not save the service price.');
    } finally {
      setBusy(false);
    }
  }, [load, resetEditor]);

  const savePending = useCallback(() => {
    if (!reportId || !pending || !activeMachineId) return;
    void run(async () => {
      const rate = parsePrice(price, pending.service.baseRateCentavos);
      await addMachineService(db, reportId, {
        equipmentId: activeMachineId,
        serviceId: pending.service.id,
        rateCentavos: rate,
        note,
        alsoEquipmentIds: alsoIds,
      });
    });
  }, [activeMachineId, alsoIds, db, note, pending, price, reportId, run]);

  const saveEdit = useCallback(() => {
    if (!reportId || !editingId) return;
    void run(async () => {
      await updateMachineService(db, reportId, editingId, { rateCentavos: parsePrice(price, null), note });
    });
  }, [db, editingId, note, price, reportId, run]);

  const startEdit = useCallback((row: ServiceReportMachineService) => {
    setPending(null);
    setEditingId(row.id);
    setPrice((row.rateCentavos / 100).toFixed(2));
    setNote(row.note ?? '');
    setError(null);
  }, []);

  const confirmRemove = useCallback((row: ServiceReportMachineService) => {
    if (!reportId) return;
    Alert.alert('Remove this service price?', `${row.serviceName} on ${row.machineLabel} will be removed from the CSR and its linked billing statement draft.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void run(() => removeMachineService(db, reportId, row.id)) },
    ]);
  }, [db, reportId, run]);

  const toggleAlso = useCallback((equipmentId: string) => {
    setAlsoIds((current) => (current.includes(equipmentId) ? current.filter((id) => id !== equipmentId) : [...current, equipmentId]));
  }, []);

  if (!report) {
    return <View style={styles.centered}>{error ? <Text selectable style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.brandBlue} size="large" />}</View>;
  }
  if (report.documentState !== 'draft') {
    return <View style={styles.centered}><Text selectable style={styles.help}>Service prices can only be changed while the CSR is a draft.</Text></View>;
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Services by machine' }} />
      <View style={styles.summary}>
        <Text selectable style={styles.eyebrow}>CSR TOTAL (DRAFT)</Text>
        <Text selectable style={styles.total}>{formatCentavos(report.totalBillCentavos)}</Text>
        <Text selectable style={styles.help}>Each service is priced for the machine it was done on. Prices can differ per machine; the total and any linked billing statement use exactly what you enter.</Text>
      </View>
      {error ? <Text selectable accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}

      {report.machines.map((machine, index) => {
        const rows = servicesByMachine.get(machine.equipmentId) ?? [];
        const subtotal = rows.reduce((sum, row) => sum + row.rateCentavos, 0);
        const active = machine.equipmentId === activeMachineId;
        return (
          <View key={machine.equipmentId} style={[styles.panel, active ? styles.panelActive : null]}>
            <View style={styles.panelHeader}>
              <View style={styles.flex}>
                <Text selectable style={styles.panelTitle}>Machine {index + 1}: {machineLabel(machine)}</Text>
                {machine.model ? <Text selectable style={styles.help}>Model {machine.model}</Text> : null}
              </View>
              <Text selectable style={styles.subtotal}>{formatCentavos(subtotal)}</Text>
            </View>

            {rows.map((row) => (
              <View key={row.id} style={styles.row}>
                <View style={styles.rowTop}>
                  <View style={styles.flex}>
                    <Text selectable style={styles.rowName}>{row.serviceName}</Text>
                    {row.note ? <Text selectable style={styles.help}>{row.note}</Text> : null}
                  </View>
                  <Text selectable style={styles.rowPrice}>{formatCentavos(row.rateCentavos)}</Text>
                </View>
                {editingId === row.id ? (
                  <View style={styles.editor}>
                    <FormField keyboardType="decimal-pad" label="Price for this machine" onChangeText={setPrice} value={price} />
                    <FormField label="Note (optional)" onChangeText={setNote} value={note} />
                    <ActionButton disabled={busy} onPress={saveEdit}>{busy ? 'Saving…' : 'Save price'}</ActionButton>
                    <ActionButton disabled={busy} variant="secondary" onPress={resetEditor}>Cancel</ActionButton>
                  </View>
                ) : (
                  <View style={styles.rowActions}>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => startEdit(row)}><Text style={styles.link}>Edit price</Text></Pressable>
                    <Pressable accessibilityRole="button" disabled={busy} onPress={() => confirmRemove(row)}><Text style={styles.remove}>Remove</Text></Pressable>
                  </View>
                )}
              </View>
            ))}
            {rows.length === 0 ? <Text selectable style={styles.empty}>No services on this machine yet.</Text> : null}

            {active && pending ? (
              <View style={styles.editor}>
                <Text selectable style={styles.editorTitle}>{pending.service.name}</Text>
                <FormField
                  hint={pending.service.baseRateCentavos > 0 ? `Catalog price ${formatCentavos(pending.service.baseRateCentavos)}. Change it for this machine if needed.` : 'This service has no fixed price. Enter the price for this machine.'}
                  keyboardType="decimal-pad"
                  label="Price for this machine"
                  onChangeText={setPrice}
                  placeholder="0.00"
                  value={price}
                />
                <FormField label="Note (optional)" onChangeText={setNote} placeholder="For example: heavy duty, return visit" value={note} />
                {report.machines.length > 1 ? (
                  <View style={styles.alsoBox}>
                    <Text selectable style={styles.alsoTitle}>Also add at this price to:</Text>
                    <View style={styles.chips}>
                      {report.machines.filter((other) => other.equipmentId !== machine.equipmentId).map((other) => {
                        const selected = alsoIds.includes(other.equipmentId);
                        return (
                          <Pressable
                            key={other.equipmentId}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: selected }}
                            onPress={() => toggleAlso(other.equipmentId)}
                            style={[styles.chip, selected ? styles.chipSelected : null]}
                          >
                            <Text style={selected ? styles.chipTextSelected : styles.chipText}>{selected ? '✓ ' : ''}{machineLabel(other)}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
                <ActionButton disabled={busy} onPress={savePending}>
                  {busy ? 'Saving…' : alsoIds.length ? `Add to ${alsoIds.length + 1} machines` : 'Add to this machine'}
                </ActionButton>
                <ActionButton disabled={busy} variant="secondary" onPress={resetEditor}>Cancel</ActionButton>
              </View>
            ) : (
              <ActionButton compact variant={active ? 'primary' : 'secondary'} disabled={busy} onPress={() => chooseMachine(machine.equipmentId)}>
                {active ? 'Adding here — pick a service below' : 'Add service to this machine'}
              </ActionButton>
            )}
          </View>
        );
      })}

      <ServicePicker
        services={catalog}
        onSelect={pickService}
        onCreated={handleServiceCreated}
        disabled={busy}
        heading={activeMachine ? `Adding to: ${machineLabel(activeMachine)}` : 'Pick a machine above, then choose a service'}
      />
    </ScrollView>
  );
}

/** Blank uses the catalog price when there is one; a service with no fixed price must be priced by hand. */
function parsePrice(value: string, catalogRateCentavos: number | null): number {
  if (!value.trim()) {
    if (catalogRateCentavos && catalogRateCentavos > 0) return catalogRateCentavos;
    throw new Error('Enter the price for this machine.');
  }
  return parseCurrencyToCentavos(value);
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.background },
  content: { gap: 14, padding: 18, paddingBottom: 44 },
  summary: { gap: 4, padding: 16, backgroundColor: '#eaf2ff', borderRadius: 16, borderCurve: 'continuous' },
  eyebrow: { color: colors.brandBlue, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  total: { color: colors.brandNavy, fontSize: 24, fontWeight: '900' },
  help: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 17 },
  error: { color: colors.error, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  panel: { gap: 10, padding: 14, borderWidth: 1, borderColor: colors.separator, borderRadius: 16, borderCurve: 'continuous', backgroundColor: colors.surface },
  panelActive: { borderColor: colors.brandBlue, borderWidth: 2 },
  panelHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  panelTitle: { color: colors.label, fontSize: 15, fontWeight: '800' },
  subtotal: { color: colors.brandNavy, fontSize: 15, fontWeight: '900' },
  row: { gap: 8, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rowName: { color: colors.label, fontSize: 14, fontWeight: '700' },
  rowPrice: { color: colors.label, fontSize: 14, fontWeight: '800' },
  rowActions: { flexDirection: 'row', gap: 20 },
  link: { color: colors.brandBlue, fontSize: 12, fontWeight: '800' },
  remove: { color: colors.error, fontSize: 12, fontWeight: '800' },
  empty: { color: colors.secondaryLabel, fontSize: 13, fontStyle: 'italic' },
  editor: { gap: 10, padding: 12, borderRadius: 14, borderCurve: 'continuous', backgroundColor: '#eaf2ff' },
  editorTitle: { color: colors.brandNavy, fontSize: 15, fontWeight: '800' },
  alsoBox: { gap: 6 },
  alsoTitle: { color: colors.label, fontSize: 13, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: colors.separator, borderRadius: 20, backgroundColor: colors.surface },
  chipSelected: { borderColor: colors.brandBlue, backgroundColor: '#ffffff' },
  chipText: { color: colors.secondaryLabel, fontSize: 12, fontWeight: '700' },
  chipTextSelected: { color: colors.brandNavy, fontSize: 12, fontWeight: '800' },
});
