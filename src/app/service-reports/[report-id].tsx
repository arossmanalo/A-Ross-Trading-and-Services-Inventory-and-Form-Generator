import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { formatCentavos } from '@/domain/money';
import {
  DraftPriceChangedError,
  deleteServiceReportDraft,
  getServiceReport,
  removeReportServiceUsage,
  removeReportItemUsage,
  updateServiceReportDraft,
} from '@/features/service-reports/service-report-repository';
import {
  finalizeAndRenderServiceReport,
  retryServiceReportPdf,
  shareServiceReportPdf,
} from '@/features/service-reports/service-report-pdf';
import type { ServiceOutcome, ServiceReportDetail } from '@/features/service-reports/service-report-types';
import { colors } from '@/theme/colors';

type FormState = {
  businessDate: string;
  backdateReason: string;
  serviceOutcome: ServiceOutcome;
  reportedProblem: string;
  diagnosis: string;
  actionTaken: string;
  recommendations: string;
  billing: string;
  customerRemarks: string;
  machineStatus: string;
  warrantyText: string;
  servicedBy: string;
  acknowledgedBy: string;
};

const EMPTY_FORM: FormState = {
  businessDate: '', backdateReason: '', serviceOutcome: 'incomplete', reportedProblem: '', diagnosis: '', actionTaken: '', recommendations: '', billing: '', customerRemarks: '', machineStatus: '', warrantyText: '', servicedBy: '', acknowledgedBy: '',
};

export default function ServiceReportDetailScreen() {
  const { 'report-id': reportId } = useLocalSearchParams<{ 'report-id': string }>();
  const db = useSQLiteContext();
  const [report, setReport] = useState<ServiceReportDetail | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    if (!reportId) return;
    setLoading(true);
    try {
      const result = await getServiceReport(db, reportId);
      if (!result) throw new Error('CSR was not found.');
      setReport(result);
      setForm(toForm(result));
      setDirty(false);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load CSR.');
    } finally {
      setLoading(false);
    }
  }, [db, reportId]);

  useFocusEffect(useCallback(() => { void loadReport(); }, [loadReport]));

  const saveDraft = useCallback(async () => {
    if (!reportId || report?.documentState !== 'draft') return;
    await updateServiceReportDraft(db, reportId, toDraftInput(form));
    setDirty(false);
    setStatus('Draft saved');
  }, [db, form, report?.documentState, reportId]);

  useEffect(() => {
    if (!dirty || report?.documentState !== 'draft') return;
    setStatus('Saving…');
    const timer = setTimeout(() => {
      void saveDraft().catch((saveError: unknown) => {
        setStatus('');
        setError(saveError instanceof Error ? saveError.message : 'Autosave failed.');
      });
    }, 900);
    return () => clearTimeout(timer);
  }, [dirty, report?.documentState, saveDraft]);

  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setStatus('Unsaved changes');
  }, []);

  const addItem = useCallback(() => {
    if (!reportId) return;
    void (dirty ? saveDraft() : Promise.resolve())
      .then(() => router.push({ pathname: '/service-reports/item-usage/new', params: { reportId } }))
      .catch((saveError: unknown) => {
        setError(saveError instanceof Error ? saveError.message : 'Save the draft before adding items.');
      });
  }, [dirty, reportId, saveDraft]);

  const addService = useCallback(() => {
    if (!reportId) return;
    void (dirty ? saveDraft() : Promise.resolve())
      .then(() => router.push({ pathname: '/service-reports/service-usage/new', params: { reportId } }))
      .catch((saveError: unknown) => {
        setError(saveError instanceof Error ? saveError.message : 'Save the draft before adding services.');
      });
  }, [dirty, reportId, saveDraft]);

  const removeUsage = useCallback((usageId: string) => {
    if (!reportId) return;
    Alert.alert('Remove item usage?', 'Draft stock has not been deducted yet.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeReportItemUsage(db, reportId, usageId).then(loadReport).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not remove item.')) },
    ]);
  }, [db, loadReport, reportId]);

  const removeService = useCallback((usageId: string) => {
    if (!reportId) return;
    Alert.alert('Remove service usage?', 'The service will be removed from this draft total.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeReportServiceUsage(db, reportId, usageId).then(loadReport).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not remove service.')) },
    ]);
  }, [db, loadReport, reportId]);

  const runFinalize = useCallback(async (policy: 'keep-draft' | 'reject' | 'use-current') => {
    if (!reportId) return;
    setBusy(true);
    setError(null);
    try {
      if (dirty) await saveDraft();
      await finalizeAndRenderServiceReport(db, reportId, policy);
      await loadReport();
    } catch (finalizeError) {
      if (finalizeError instanceof DraftPriceChangedError) {
        Alert.alert('Prices changed', finalizeError.message, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Keep draft prices', onPress: () => void runFinalize('keep-draft') },
          { text: 'Use current prices', onPress: () => void runFinalize('use-current') },
        ]);
      } else {
        setError(finalizeError instanceof Error ? finalizeError.message : 'Could not finalize CSR.');
        await loadReport();
      }
    } finally {
      setBusy(false);
    }
  }, [db, dirty, loadReport, reportId, saveDraft]);

  const finalize = useCallback(() => {
    Alert.alert('Finalize CSR?', 'This will allocate the next CSR number and deduct all listed items. Finalized content cannot be edited.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Finalize', onPress: () => void runFinalize('reject') },
    ]);
  }, [runFinalize]);

  const deleteDraft = useCallback(() => {
    if (!reportId) return;
    Alert.alert('Delete draft?', 'This unnumbered draft and its unposted item rows will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void deleteServiceReportDraft(db, reportId)
          .then(() => router.back())
          .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not delete draft.')),
      },
    ]);
  }, [db, reportId]);

  const retryPdf = useCallback(async () => {
    if (!reportId) return;
    setBusy(true);
    try { await retryServiceReportPdf(db, reportId); await loadReport(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not render PDF.'); }
    finally { setBusy(false); }
  }, [db, loadReport, reportId]);

  const sharePdf = useCallback(async () => {
    if (!reportId) return;
    setBusy(true);
    try { await shareServiceReportPdf(db, reportId); await loadReport(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not share PDF.'); }
    finally { setBusy(false); }
  }, [db, loadReport, reportId]);

  const followUp = useCallback(() => {
    if (!report) return;
    router.push({ pathname: '/service-reports/new', params: { followsCsrId: report.id, customerId: report.customerId, equipmentId: report.equipmentId } });
  }, [report]);

  const openVoid = useCallback(() => {
    if (reportId) router.push({ pathname: '/service-reports/void', params: { reportId } });
  }, [reportId]);

  if (loading && !report) return <View style={styles.centered}><ActivityIndicator color={colors.brandBlue} size="large" /></View>;
  const editable = report?.documentState === 'draft';

  return (
    <>
      <Stack.Screen options={{ title: report?.csrNumber ?? 'CSR Draft' }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {report ? (
          <View style={styles.summary}>
            <View style={styles.summaryHeader}><Text selectable style={styles.eyebrow}>{report.csrNumber ?? 'UNNUMBERED DRAFT'}</Text><Text selectable style={styles.state}>{report.documentState.toUpperCase()}</Text></View>
            <Text selectable style={styles.customer}>{report.customerName}</Text>
            <Text selectable style={styles.meta}>{report.equipmentName} · {report.businessDate}</Text>
            <Text selectable style={styles.meta}>PDF {report.pdfState} · {report.shareState === 'shared' ? 'share sheet opened' : 'not shared'}</Text>
          </View>
        ) : null}
        {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
        {editable ? (
          <>
            <Text selectable style={styles.saveStatus}>{status}</Text>
            <FormField label="Business date" onChangeText={(v) => setField('businessDate', v)} value={form.businessDate} />
            <FormField label="Backdate reason" onChangeText={(v) => setField('backdateReason', v)} value={form.backdateReason} />
            <Text selectable style={styles.sectionTitle}>Status after service</Text>
            <View style={styles.outcomes}>{(['completed', 'incomplete', 'waiting_for_parts', 'under_observation'] as ServiceOutcome[]).map((outcome) => <Pressable key={outcome} onPress={() => setField('serviceOutcome', outcome)} style={[styles.outcome, form.serviceOutcome === outcome ? styles.outcomeSelected : null]}><Text selectable style={styles.outcomeText}>{formatLabel(outcome)}</Text></Pressable>)}</View>
            <Multiline label="Reported Problem" value={form.reportedProblem} onChange={(v) => setField('reportedProblem', v)} />
            <Multiline label="Diagnosis" value={form.diagnosis} onChange={(v) => setField('diagnosis', v)} />
            <Multiline label="Action Taken" value={form.actionTaken} onChange={(v) => setField('actionTaken', v)} />
            <Multiline label="Recommendations" value={form.recommendations} onChange={(v) => setField('recommendations', v)} />
            <Multiline label="Machine Status" value={form.machineStatus} onChange={(v) => setField('machineStatus', v)} />
            <Multiline label="Billing notes" value={form.billing} onChange={(v) => setField('billing', v)} />
            <Multiline label="Warranty" value={form.warrantyText} onChange={(v) => setField('warrantyText', v)} />
            <Multiline label="Customer's Remarks" value={form.customerRemarks} onChange={(v) => setField('customerRemarks', v)} />
            <FormField label="Serviced By" onChangeText={(v) => setField('servicedBy', v)} value={form.servicedBy} />
            <FormField label="Acknowledged By" onChangeText={(v) => setField('acknowledgedBy', v)} value={form.acknowledgedBy} />
            <View style={styles.totalCard}><Text selectable style={styles.eyebrow}>AUTO-COMPUTED TOTAL</Text><Text selectable style={styles.total}>{formatCentavos(report.totalBillCentavos)}</Text><Text selectable style={styles.totalHelp}>Billable inventory items plus selected service rates. Non-billable items are excluded.</Text></View>
            <View style={styles.sectionHeader}><Text selectable style={styles.sectionTitle}>Items used</Text><ActionButton compact onPress={addItem}>Add item</ActionButton></View>
            {report?.usages.map((usage) => <View key={usage.id} style={styles.usage}><View style={styles.usageCopy}><Text selectable style={styles.usageName}>{usage.itemName}</Text><Text selectable style={styles.meta}>{usage.quantity} {usage.unitLabel} · {usage.billable ? `Billable ${formatCentavos(usage.resolvedSellingPriceCentavos ?? 0)}` : 'Non-billable'}</Text></View><Pressable onPress={() => removeUsage(usage.id)}><Text selectable style={styles.remove}>Remove</Text></Pressable></View>)}
            {!report.usages.length ? <Text selectable style={styles.emptyHint}>No inventory items added yet.</Text> : null}
            <View style={styles.sectionHeader}><Text selectable style={styles.sectionTitle}>Services used</Text><ActionButton compact onPress={addService}>Add service</ActionButton></View>
            {report.services.map((service) => <View key={service.id} style={styles.usage}><View style={styles.usageCopy}><Text selectable style={styles.usageName}>{service.serviceName}</Text><Text selectable style={styles.meta}>{formatCentavos(service.resolvedRateCentavos)} · quantity 1{service.rateSource === 'override' ? ' · custom rate' : ''}</Text></View><Pressable onPress={() => removeService(service.id)}><Text selectable style={styles.remove}>Remove</Text></Pressable></View>)}
            {!report.services.length ? <Text selectable style={styles.emptyHint}>No services added yet.</Text> : null}
            <ActionButton disabled={busy} onPress={finalize}>{busy ? 'Working…' : 'Finalize CSR'}</ActionButton>
            <ActionButton disabled={busy} onPress={deleteDraft} variant="danger">Delete draft</ActionButton>
          </>
        ) : report ? (
          <>
            <ReadSection label="Reported Problem" values={report.reportedProblem} />
            <ReadSection label="Diagnosis" values={report.diagnosis} />
            <ReadSection label="Action Taken" values={report.actionTaken} />
            <ReadSection label="Recommendations" values={report.recommendations} />
            <ReadSection label="Machine Status" values={[report.machineStatus]} />
            <ReadSection label="Warranty" values={[report.warrantyText]} />
            <View style={styles.totalCard}><Text selectable style={styles.eyebrow}>TOTAL BILL</Text><Text selectable style={styles.total}>{formatCentavos(report.totalBillCentavos)}</Text><Text selectable style={styles.totalHelp}>Derived from billable inventory items and service rates.</Text></View>
            {report.pdfState !== 'ready' ? <ActionButton disabled={busy} onPress={() => void retryPdf()}>Retry PDF</ActionButton> : <ActionButton disabled={busy} onPress={() => void sharePdf()}>Share PDF</ActionButton>}
            <ActionButton onPress={() => router.push({ pathname: '/signatures/manage', params: { ownerType: 'service_report', ownerId: reportId } })} variant="secondary">Signing & returned PDF</ActionButton>
            {report.documentState === 'finalized' ? (
              <>
                <ActionButton disabled={busy} onPress={followUp} variant="secondary">Create follow-up CSR</ActionButton>
                <ActionButton disabled={busy} onPress={openVoid} variant="danger">Void and reissue</ActionButton>
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

function Multiline({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <FormField label={label} multiline onChangeText={onChange} style={styles.multiline} textAlignVertical="top" value={value} hint={label === 'Machine Status' || label === 'Warranty' ? undefined : 'One entry per line'} />;
}

function ReadSection({ label, values }: { label: string; values: string[] }) {
  return <View style={styles.readSection}><Text selectable style={styles.eyebrow}>{label.toUpperCase()}</Text><Text selectable style={styles.readText}>{values.filter(Boolean).join('\n') || '-'}</Text></View>;
}

function toForm(report: ServiceReportDetail): FormState {
  return { businessDate: report.businessDate, backdateReason: report.backdateReason ?? '', serviceOutcome: report.serviceOutcome, reportedProblem: report.reportedProblem.join('\n'), diagnosis: report.diagnosis.join('\n'), actionTaken: report.actionTaken.join('\n'), recommendations: report.recommendations.join('\n'), billing: report.billing.join('\n'), customerRemarks: report.customerRemarks.join('\n'), machineStatus: report.machineStatus, warrantyText: report.warrantyText, servicedBy: report.servicedBy, acknowledgedBy: report.acknowledgedBy };
}

function toDraftInput(form: FormState) {
  const lines = (value: string) => value.split('\n');
  return { businessDate: form.businessDate, backdateReason: form.backdateReason, serviceOutcome: form.serviceOutcome, reportedProblem: lines(form.reportedProblem), diagnosis: lines(form.diagnosis), actionTaken: lines(form.actionTaken), recommendations: lines(form.recommendations), billing: lines(form.billing), customerRemarks: lines(form.customerRemarks), machineStatus: form.machineStatus, warrantyText: form.warrantyText, servicedBy: form.servicedBy, acknowledgedBy: form.acknowledgedBy };
}

function formatLabel(value: string) { return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()); }

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { gap: 16, padding: 18, paddingBottom: 44 },
  summary: { gap: 5, padding: 17, backgroundColor: '#eaf2ff', borderRadius: 17, borderCurve: 'continuous' },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  eyebrow: { color: colors.brandBlue, fontSize: 10, fontWeight: '900', letterSpacing: .8 },
  state: { color: colors.success, fontSize: 9, fontWeight: '900', letterSpacing: .7 },
  customer: { color: colors.brandNavy, fontSize: 20, fontWeight: '900' },
  meta: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 17 },
  saveStatus: { minHeight: 18, color: colors.secondaryLabel, fontSize: 12, textAlign: 'right' },
  sectionTitle: { color: colors.label, fontSize: 17, fontWeight: '900' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  outcomes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  outcome: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: colors.separator, borderRadius: 12, borderCurve: 'continuous' },
  outcomeSelected: { borderColor: colors.brandBlue, backgroundColor: '#eaf2ff' },
  outcomeText: { color: colors.label, fontSize: 12, fontWeight: '700' },
  multiline: { minHeight: 88 },
  usage: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderWidth: 1, borderColor: colors.separator, borderRadius: 14, borderCurve: 'continuous' },
  usageCopy: { flex: 1, gap: 4 },
  usageName: { color: colors.label, fontSize: 14, fontWeight: '800' },
  remove: { color: colors.error, fontSize: 12, fontWeight: '800' },
  readSection: { gap: 5, padding: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.separator, borderRadius: 14, borderCurve: 'continuous' },
  readText: { color: colors.label, fontSize: 14, lineHeight: 20 },
  total: { color: colors.brandNavy, fontSize: 19, fontWeight: '900', textAlign: 'right', fontVariant: ['tabular-nums'] },
  totalCard: { gap: 5, padding: 15, backgroundColor: '#eaf2ff', borderRadius: 15, borderCurve: 'continuous' },
  totalHelp: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 17 },
  emptyHint: { color: colors.secondaryLabel, fontSize: 13, fontStyle: 'italic' },
  errorText: { color: colors.error, fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
