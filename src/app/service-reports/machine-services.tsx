import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { Notice } from '@/components/notice';
import { OptionRow } from '@/components/option-row';
import { Panel } from '@/components/record-layout';
import { useSplitLayout } from '@/components/split-view';
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
import { fontSize, radius, spacing, text } from '@/theme/typography';

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
  const wide = useSplitLayout();
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
    return <View style={styles.centered}>{error ? <Text selectable style={text.error}>{error}</Text> : <ActivityIndicator color={colors.brandBlue} size="large" />}</View>;
  }
  if (report.documentState !== 'draft') {
    return <View style={styles.centered}><Text selectable style={text.meta}>Service prices can only be changed while the CSR is a draft.</Text></View>;
  }

  const machinePanels = report.machines.map((machine, index) => {
    const rows = servicesByMachine.get(machine.equipmentId) ?? [];
    const subtotal = rows.reduce((sum, row) => sum + row.rateCentavos, 0);
    const active = machine.equipmentId === activeMachineId;
    return (
      <Panel key={machine.equipmentId} style={active ? styles.panelActive : undefined}>
        <View style={styles.panelHeader}>
          <View style={styles.flex}>
            <Text selectable style={text.bodyStrong}>Machine {index + 1}: {machineLabel(machine)}</Text>
            {machine.model ? <Text selectable style={text.meta}>Model {machine.model}</Text> : null}
          </View>
          <Text selectable style={text.amount}>{formatCentavos(subtotal)}</Text>
        </View>

        {rows.map((row) => (
          <View key={row.id} style={styles.row}>
            <View style={styles.rowTop}>
              <View style={styles.flex}>
                <Text selectable style={text.body}>{row.serviceName}</Text>
                {row.note ? <Text selectable style={text.meta}>{row.note}</Text> : null}
              </View>
              <Text selectable style={text.amount}>{formatCentavos(row.rateCentavos)}</Text>
            </View>
            {editingId === row.id ? (
              <View style={styles.editor}>
                <FormField keyboardType="decimal-pad" label="Price for this machine" onChangeText={setPrice} value={price} />
                <FormField label="Note (optional)" onChangeText={setNote} value={note} />
                <View style={styles.editorActions}>
                  <ActionButton compact disabled={busy} onPress={saveEdit}>{busy ? 'Saving…' : 'Save price'}</ActionButton>
                  <ActionButton compact disabled={busy} variant="secondary" onPress={resetEditor}>Cancel</ActionButton>
                </View>
              </View>
            ) : (
              <View style={styles.rowActions}>
                <Pressable accessibilityRole="button" disabled={busy} hitSlop={8} onPress={() => startEdit(row)}>
                  <Text style={styles.link}>Edit price</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy} hitSlop={8} onPress={() => confirmRemove(row)}>
                  <Text style={styles.remove}>Remove</Text>
                </Pressable>
              </View>
            )}
          </View>
        ))}
        {rows.length === 0 ? <Text selectable style={[text.meta, styles.inset]}>No services on this machine yet.</Text> : null}

        <View style={styles.panelFooter}>
          {active && pending ? (
            <View style={styles.editor}>
              <Text selectable style={text.subhead}>{pending.service.name}</Text>
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
                <View style={styles.also}>
                  <Text style={text.label}>Also add at this price to</Text>
                  {report.machines.filter((other) => other.equipmentId !== machine.equipmentId).map((other) => (
                    <OptionRow
                      key={other.equipmentId}
                      kind="checkbox"
                      label={machineLabel(other)}
                      selected={alsoIds.includes(other.equipmentId)}
                      onPress={() => toggleAlso(other.equipmentId)}
                    />
                  ))}
                </View>
              ) : null}
              <View style={styles.editorActions}>
                <ActionButton compact disabled={busy} onPress={savePending}>
                  {busy ? 'Saving…' : alsoIds.length ? `Add to ${alsoIds.length + 1} machines` : 'Add to this machine'}
                </ActionButton>
                <ActionButton compact disabled={busy} variant="secondary" onPress={resetEditor}>Cancel</ActionButton>
              </View>
            </View>
          ) : (
            <ActionButton
              compact
              variant={active ? 'primary' : 'secondary'}
              disabled={busy}
              style={styles.addButton}
              onPress={() => chooseMachine(machine.equipmentId)}
            >
              {active ? (wide ? 'Adding here — pick a service on the right' : 'Adding here — pick a service below') : 'Add service to this machine'}
            </ActionButton>
          )}
        </View>
      </Panel>
    );
  });

  const picker = (
    <ServicePicker
      services={catalog}
      onSelect={pickService}
      onCreated={handleServiceCreated}
      disabled={busy}
      heading={activeMachine
        ? `Adding to: ${machineLabel(activeMachine)}`
        : wide ? 'Pick a machine on the left, then choose a service' : 'Pick a machine above, then choose a service'}
    />
  );

  const summary = (
    <Notice label="CSR total (draft)" amount={formatCentavos(report.totalBillCentavos)}>
      Each service is priced for the machine it was done on. Prices can differ per machine; the total and any
      linked billing statement use exactly what you enter.
    </Notice>
  );
  const errorText = error
    ? <Text selectable accessibilityLiveRegion="polite" style={text.error}>{error}</Text>
    : null;

  return (
    <>
      <Stack.Screen options={{ title: 'Services by machine' }} />
      {wide ? (
        <View style={styles.columns}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" style={styles.machines}>
            {summary}
            {errorText}
            {machinePanels}
          </ScrollView>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" style={styles.pickerColumn}>
            {picker}
          </ScrollView>
        </View>
      ) : (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {summary}
          {errorText}
          {machinePanels}
          {picker}
        </ScrollView>
      )}
    </>
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
  columns: { flex: 1, flexDirection: 'row' },
  machines: { flex: 3 },
  pickerColumn: { flex: 2, borderLeftWidth: 1, borderLeftColor: colors.separator, backgroundColor: colors.surface },
  content: { gap: spacing.lg, padding: spacing.xl, paddingBottom: spacing.xxl * 2 },
  panelActive: { borderColor: colors.primary, borderWidth: 2 },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.subtleSurface,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  rowActions: { flexDirection: 'row', gap: spacing.xl },
  link: { color: colors.primary, fontSize: fontSize.meta, fontWeight: '600' },
  remove: { color: colors.error, fontSize: fontSize.meta, fontWeight: '600' },
  inset: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  panelFooter: { padding: spacing.lg },
  addButton: { alignSelf: 'flex-start' },
  editor: { gap: spacing.md, padding: spacing.md, borderRadius: radius.control, backgroundColor: colors.accentTint },
  editorActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  also: { gap: spacing.sm },
});
