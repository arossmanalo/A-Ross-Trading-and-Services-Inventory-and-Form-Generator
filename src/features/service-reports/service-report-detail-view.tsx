import { Stack, router, useFocusEffect } from 'expo-router';
import * as Print from 'expo-print';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { ActionMenu } from '@/components/action-menu';
import { DateField } from '@/components/date-field';
import { FormField } from '@/components/form-field';
import { Fact, Panel, RecordHeader, SectionTitle } from '@/components/record-layout';
import { StatusChip, documentStateTone, sentenceCase } from '@/components/status-chip';
import { getLocalBusinessDate } from '@/domain/business-date';
import { formatDisplayDate } from '@/domain/calendar';
import { formatCentavos } from '@/domain/money';
import { createBillingStatementDraft } from '@/features/billing-statements/billing-statement-repository';
import { getCustomerDetail } from '@/features/customers/customer-repository';
import type { CustomerEquipment } from '@/features/customers/customer-types';
import { getServiceReportShareBundle, shareBundle } from '@/features/documents/share-bundle';
import {
  finalizeAndRenderServiceReport,
  retryServiceReportPdf,
} from '@/features/service-reports/service-report-pdf';
import {
  DraftPriceChangedError,
  addReportEquipment,
  deleteServiceReportDraft,
  getServiceReport,
  removeReportEquipment,
  removeReportItemUsage,
  updateServiceReportDraft,
} from '@/features/service-reports/service-report-repository';
import type { ServiceOutcome, ServiceReportDetail } from '@/features/service-reports/service-report-types';
import { getSignedPreviewTarget } from '@/features/signatures/signed-preview';
import { colors } from '@/theme/colors';
import { fontSize, radius, spacing, text } from '@/theme/typography';

type FormState = {
  businessDate: string;
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
  businessDate: '', serviceOutcome: 'incomplete', reportedProblem: '', diagnosis: '', actionTaken: '', recommendations: '', billing: '', customerRemarks: '', machineStatus: '', warrantyText: '', servicedBy: '', acknowledgedBy: '',
};

const OUTCOMES: ServiceOutcome[] = ['completed', 'incomplete', 'waiting_for_parts', 'under_observation'];

/** Draft text fields shown two to a row; the hint matches the old "one entry per line" rule. */
const DRAFT_TEXT_FIELDS: Array<{ key: keyof FormState; label: string; perLine: boolean }> = [
  { key: 'reportedProblem', label: 'Reported problem', perLine: true },
  { key: 'diagnosis', label: 'Diagnosis', perLine: true },
  { key: 'actionTaken', label: 'Action taken', perLine: true },
  { key: 'recommendations', label: 'Recommendations', perLine: true },
  { key: 'machineStatus', label: 'Machine status', perLine: false },
  { key: 'billing', label: 'Billing notes', perLine: true },
  { key: 'warrantyText', label: 'Warranty', perLine: false },
  { key: 'customerRemarks', label: "Customer's remarks", perLine: true },
];

type ServiceReportDetailViewProps = {
  reportId: string;
  /** Shown beside the CSR list: no screen title, and deleting clears the selection instead of going back. */
  embedded?: boolean;
  onDeleted?: () => void;
  /** Called after a change that the list should reflect, such as finalizing. */
  onChanged?: () => void;
};

export function ServiceReportDetailView({ reportId, embedded = false, onDeleted, onChanged }: ServiceReportDetailViewProps) {
  const db = useSQLiteContext();
  const [report, setReport] = useState<ServiceReportDetail | null>(null);
  const [availableMachines, setAvailableMachines] = useState<CustomerEquipment[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const editVersion = useRef(0);
  const pendingSave = useRef<Promise<void>>(Promise.resolve());

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getServiceReport(db, reportId);
      if (!result) throw new Error('CSR was not found.');
      setReport(result);
      if (result.documentState === 'draft') {
        const customer = await getCustomerDetail(db, result.customerId);
        const listed = new Set(result.machines.map((machine) => machine.equipmentId));
        setAvailableMachines((customer?.equipment ?? []).filter((entry) => entry.active && !listed.has(entry.id)));
      } else {
        setAvailableMachines([]);
      }
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

  const saveDraft = useCallback((): Promise<void> => {
    if (report?.documentState !== 'draft') return Promise.resolve();
    const input = toDraftInput(form);
    const version = editVersion.current;
    const next = pendingSave.current.catch(() => undefined).then(async () => {
      await updateServiceReportDraft(db, reportId, input);
      if (editVersion.current === version) {
        setDirty(false);
        setStatus('Draft saved');
      }
    });
    pendingSave.current = next;
    return next;
  }, [db, form, report?.documentState, reportId]);

  // Switching records or sections unmounts this view; keep what was typed since the last autosave.
  const unsaved = useRef({ dirty: false, form: EMPTY_FORM, draft: false });
  useEffect(() => {
    unsaved.current = { dirty, form, draft: report?.documentState === 'draft' };
  });
  useEffect(() => () => {
    const pending = unsaved.current;
    if (!pending.dirty || !pending.draft) return;
    void pendingSave.current
      .catch(() => undefined)
      .then(() => updateServiceReportDraft(db, reportId, toDraftInput(pending.form)))
      // The view is gone, so there is nowhere to show a failure; the draft keeps its last saved values.
      .catch(() => undefined);
  }, [db, reportId]);

  useEffect(() => {
    if (!dirty || busy || report?.documentState !== 'draft') return;
    setStatus('Saving…');
    const timer = setTimeout(() => {
      void saveDraft().catch((saveError: unknown) => {
        setStatus('');
        setError(saveError instanceof Error ? saveError.message : 'Autosave failed.');
      });
    }, 900);
    return () => clearTimeout(timer);
  }, [busy, dirty, report?.documentState, saveDraft]);

  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    editVersion.current += 1;
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setStatus('Unsaved changes');
  }, []);

  const addItem = useCallback(() => {
    void (dirty ? saveDraft() : Promise.resolve())
      .then(() => router.push({ pathname: '/service-reports/item-usage/new', params: { reportId } }))
      .catch((saveError: unknown) => {
        setError(saveError instanceof Error ? saveError.message : 'Save the draft before adding items.');
      });
  }, [dirty, reportId, saveDraft]);

  const addService = useCallback(() => {
    void (dirty ? saveDraft() : Promise.resolve())
      .then(() => router.push({ pathname: '/service-reports/machine-services', params: { reportId } }))
      .catch((saveError: unknown) => {
        setError(saveError instanceof Error ? saveError.message : 'Save the draft before adding services.');
      });
  }, [dirty, reportId, saveDraft]);

  const removeUsage = useCallback((usageId: string) => {
    Alert.alert('Remove item usage?', 'Draft stock has not been deducted yet.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeReportItemUsage(db, reportId, usageId).then(loadReport).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not remove item.')) },
    ]);
  }, [db, loadReport, reportId]);

  const changeMachines = useCallback((action: () => Promise<void>, failure: string) => {
    void action()
      .then(loadReport)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : failure));
  }, [loadReport]);

  const removeMachine = useCallback((equipmentId: string, label: string) => {
    Alert.alert('Remove machine?', `${label} will be removed from this draft. Service charges are recalculated for the remaining machines.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => changeMachines(() => removeReportEquipment(db, reportId, equipmentId), 'Could not remove machine.') },
    ]);
  }, [changeMachines, db, reportId]);

  const addMachine = useCallback((equipmentId: string) => {
    changeMachines(async () => {
      if (dirty) await saveDraft();
      await addReportEquipment(db, reportId, equipmentId);
    }, 'Could not add machine.');
  }, [changeMachines, db, dirty, reportId, saveDraft]);

  const runFinalize = useCallback(async (policy: 'keep-draft' | 'reject' | 'use-current') => {
    setBusy(true);
    setError(null);
    try {
      if (dirty) await saveDraft();
      else await pendingSave.current;
      await finalizeAndRenderServiceReport(db, reportId, policy);
      await loadReport();
      onChanged?.();
    } catch (finalizeError) {
      if (finalizeError instanceof DraftPriceChangedError) {
        Alert.alert('Prices changed', finalizeError.message, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Keep draft prices', onPress: () => void runFinalize('keep-draft') },
          { text: 'Use current prices', onPress: () => void runFinalize('use-current') },
        ]);
      } else {
        // A PDF can fail after finalization has committed. Refresh only then;
        // a rejected draft must keep its unsaved form values for correction.
        const latest = await getServiceReport(db, reportId).catch(() => null);
        if (latest && latest.documentState !== 'draft') {
          await loadReport();
          onChanged?.();
        }
        setError(finalizeError instanceof Error ? finalizeError.message : 'Could not finalize CSR.');
      }
    } finally {
      setBusy(false);
    }
  }, [db, dirty, loadReport, onChanged, reportId, saveDraft]);

  const finalize = useCallback(() => {
    Alert.alert('Finalize CSR?', 'This will allocate the next CSR number and deduct all listed items. Finalized content cannot be edited.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Finalize', onPress: () => void runFinalize('reject') },
    ]);
  }, [runFinalize]);

  const deleteDraft = useCallback(() => {
    Alert.alert('Delete draft?', 'This unnumbered CSR and its unposted item rows will be removed. Any linked unnumbered Billing Statement drafts will be deleted with it. No numbers or stock are affected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void deleteServiceReportDraft(db, reportId)
          .then(() => (onDeleted ? onDeleted() : router.back()))
          .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not delete draft.')),
      },
    ]);
  }, [db, onDeleted, reportId]);

  const retryPdf = useCallback(async () => {
    setBusy(true);
    try { await retryServiceReportPdf(db, reportId); await loadReport(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not render PDF.'); }
    finally { setBusy(false); }
  }, [db, loadReport, reportId]);

  const sharePdf = useCallback(async () => {
    setBusy(true);
    try { await shareBundle(db, await getServiceReportShareBundle(db, reportId)); await loadReport(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not share PDF.'); }
    finally { setBusy(false); }
  }, [db, loadReport, reportId]);

  const followUp = useCallback(() => {
    if (!report) return;
    router.push({ pathname: '/service-reports/new', params: { followsCsrId: report.id, customerId: report.customerId, equipmentId: report.equipmentId, equipmentIds: report.machines.map((machine) => machine.equipmentId).join(',') } });
  }, [report]);

  const openDraftPreview = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (dirty) await saveDraft();
      router.push({ pathname: '/service-reports/preview', params: { reportId } });
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Could not save the CSR before previewing.');
    } finally {
      setBusy(false);
    }
  }, [dirty, reportId, saveDraft]);

  const createBillingDraft = useCallback(async () => {
    if (!report || (report.documentState !== 'draft' && report.documentState !== 'finalized')) return;
    setBusy(true);
    setError(null);
    try {
      if (dirty && report.documentState === 'draft') await saveDraft();
      const statementId = await createBillingStatementDraft(db, {
        customerId: report.customerId,
        serviceReportId: reportId,
        businessDate: getLocalBusinessDate(),
        reuseExistingLinkedDraft: true,
      });
      router.push({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': statementId } });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create a linked Billing Statement draft.');
    } finally {
      setBusy(false);
    }
  }, [db, dirty, report, reportId, saveDraft]);

  // Once signed, the preview shows the signed version instead of the plain PDF.
  const openPreview = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const target = report?.hasSignedVersion ? await getSignedPreviewTarget(db, 'service_report', reportId) : null;
      if (target?.kind === 'capture') {
        router.push({ pathname: '/signatures/preview', params: { captureId: target.captureId, kind: 'csr', ownerId: reportId } });
      } else if (target?.kind === 'attachment') {
        await Print.printAsync({ uri: target.uri });
      } else {
        router.push({ pathname: '/service-reports/preview', params: { reportId } });
      }
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Could not open the preview.');
    } finally {
      setBusy(false);
    }
  }, [db, report?.hasSignedVersion, reportId]);

  if (loading && !report) {
    return <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }
  if (!report) {
    return <View style={styles.centered}><Text style={text.error}>{error ?? 'CSR was not found.'}</Text></View>;
  }

  const editable = report.documentState === 'draft';
  // A CSR that already has a live (draft or finalized) Billing Statement gets no second one; the linked list opens it.
  const hasLiveStatement = report.linkedStatements.some((statement) => statement.documentState !== 'voided');
  const twoColumns = width >= 900;
  const title = report.csrNumber ?? 'CSR draft';

  return (
    <>
      {embedded ? null : <Stack.Screen options={{ title }} />}
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {editable ? (
          <RecordHeader
            title={title}
            chips={<StatusChip label="Not numbered yet" tone="draft" />}
            subtitle={`${report.customerName}${status ? ` · ${status}` : ''} · stock is deducted only when you finalize`}
            actions={(
              <>
                <ActionButton compact disabled={busy} variant="danger" onPress={deleteDraft}>Delete draft</ActionButton>
                <ActionButton compact disabled={busy} variant="secondary" onPress={() => void openDraftPreview()}>Preview PDF</ActionButton>
                <ActionButton compact disabled={busy} onPress={finalize}>{busy ? 'Working…' : 'Finalize CSR'}</ActionButton>
              </>
            )}
          />
        ) : (
          <RecordHeader
            title={title}
            chips={<StatusChip label={sentenceCase(report.documentState)} tone={documentStateTone(report.documentState)} />}
            subtitle={`${report.customerName} · ${formatDisplayDate(report.businessDate)} · ${sentenceCase(report.serviceOutcome)}`}
            actions={(
              <>
                <ActionButton compact disabled={busy} variant="secondary" onPress={() => void openPreview()}>
                  {report.hasSignedVersion ? 'Preview signed PDF' : 'Preview PDF'}
                </ActionButton>
                {report.pdfState !== 'ready'
                  ? <ActionButton compact disabled={busy} onPress={() => void retryPdf()}>Retry PDF</ActionButton>
                  : <ActionButton compact disabled={busy} onPress={() => void sharePdf()}>Share PDF</ActionButton>}
                {report.documentState === 'finalized' ? (
                  <ActionMenu
                    actions={[
                      !report.hasSignedVersion && {
                        label: 'Sign document',
                        note: 'Capture or record signatures',
                        onPress: () => router.push({ pathname: '/signatures/manage', params: { ownerType: 'service_report', ownerId: reportId, mode: 'sign' } }),
                      },
                      {
                        label: 'Import signed PDF',
                        note: "The customer's signed copy",
                        onPress: () => router.push({ pathname: '/signatures/manage', params: { ownerType: 'service_report', ownerId: reportId, mode: 'import' } }),
                      },
                      !hasLiveStatement && {
                        label: 'Create a linked Billing Statement',
                        onPress: () => void createBillingDraft(),
                        disabled: busy,
                      },
                      { label: 'Create follow-up CSR', note: 'Same customer and machines', onPress: followUp, disabled: busy },
                      {
                        label: 'Void and reissue',
                        note: 'Needs a reason',
                        destructive: true,
                        disabled: busy,
                        onPress: () => router.push({ pathname: '/service-reports/void', params: { reportId } }),
                      },
                    ]}
                  />
                ) : null}
              </>
            )}
          />
        )}

        {error ? <Text accessibilityLiveRegion="polite" selectable style={text.error}>{error}</Text> : null}

        {editable ? (
          <View style={[styles.columns, twoColumns ? styles.columnsWide : null]}>
            <View style={[styles.column, twoColumns ? styles.formColumn : null]}>
              <View style={styles.inlineFields}>
                <View style={styles.dateField}>
                  <DateField label="Business date" value={form.businessDate} onChange={(value) => setField('businessDate', value)} />
                </View>
                <View style={styles.outcomeField}>
                  <Text style={text.label}>Status after service</Text>
                  <View style={styles.segmented}>
                    {OUTCOMES.map((outcome, index) => {
                      const selected = form.serviceOutcome === outcome;
                      return (
                        <Pressable
                          key={outcome}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          onPress={() => setField('serviceOutcome', outcome)}
                          style={[styles.segment, index > 0 ? styles.segmentDivider : null, selected ? styles.segmentSelected : null]}
                        >
                          <Text style={[styles.segmentText, selected ? styles.segmentTextSelected : null]}>{sentenceCase(outcome)}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </View>
              <View style={styles.fieldGrid}>
                {DRAFT_TEXT_FIELDS.map((field) => (
                  <FormField
                    key={field.key}
                    containerStyle={styles.gridField}
                    hint={field.perLine ? 'One entry per line' : undefined}
                    label={field.label}
                    multiline
                    onChangeText={(value) => setField(field.key, value)}
                    style={styles.multiline}
                    textAlignVertical="top"
                    value={form[field.key]}
                  />
                ))}
              </View>
              <View style={styles.fieldGrid}>
                <FormField containerStyle={styles.gridField} label="Serviced by" onChangeText={(value) => setField('servicedBy', value)} value={form.servicedBy} />
                {report.customerType === 'company' && report.acknowledgmentOptions.length > 1 ? (
                  <View style={styles.gridField}>
                    <Text style={text.label}>Acknowledged by</Text>
                    <View style={styles.choiceWrap}>
                      {report.acknowledgmentOptions.map((name) => {
                        const selected = form.acknowledgedBy === name;
                        return (
                          <Pressable
                            key={name}
                            accessibilityRole="radio"
                            accessibilityState={{ selected }}
                            onPress={() => setField('acknowledgedBy', name)}
                            style={[styles.choice, selected ? styles.choiceSelected : null]}
                          >
                            <Text style={[styles.segmentText, selected ? styles.choiceTextSelected : null]}>{name}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : (
                  <FormField containerStyle={styles.gridField} label="Acknowledged by" onChangeText={(value) => setField('acknowledgedBy', value)} value={form.acknowledgedBy} />
                )}
              </View>
            </View>

            <View style={[styles.column, twoColumns ? styles.asideColumn : null]}>
              <SectionTitle title={`Machines serviced (${report.machineCount})`} />
              {report.machines.map((machine) => {
                const label = [machine.machineType, machine.model, machine.nicknameOrLocation].filter(Boolean).join(' · ');
                return (
                  <View key={machine.equipmentId} style={styles.lineRow}>
                    <View style={styles.lineCopy}>
                      <Text style={text.bodyStrong}>{label}</Text>
                      {machine.serialNumber ? <Text style={text.meta}>Serial {machine.serialNumber}</Text> : null}
                    </View>
                    {report.machines.length > 1 ? (
                      <Pressable accessibilityRole="button" hitSlop={8} onPress={() => removeMachine(machine.equipmentId, label)}>
                        <Text style={styles.remove}>Remove</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
              {availableMachines.map((entry) => (
                <ActionButton key={entry.id} compact variant="secondary" disabled={busy} onPress={() => addMachine(entry.id)}>
                  {`Add ${[entry.machineType, entry.model, entry.nicknameOrLocation].filter(Boolean).join(' · ')}`}
                </ActionButton>
              ))}
              {report.machineCount > 1 ? <Text style={text.meta}>Each service is priced per machine and added to the total as entered. Item charges are not multiplied.</Text> : null}

              <SectionTitle title="Items used">
                <ActionButton compact variant="secondary" onPress={addItem}>Add item</ActionButton>
              </SectionTitle>
              {report.usages.length ? report.usages.map((usage) => (
                <View key={usage.id} style={styles.lineRow}>
                  <View style={styles.lineCopy}>
                    <Text style={text.bodyStrong}>{usage.itemName}</Text>
                    <Text style={text.meta}>
                      {usage.quantity} {usage.unitLabel} · {usage.billable ? `billable ${formatCentavos(usage.resolvedSellingPriceCentavos ?? 0)} each` : 'non-billable'}
                    </Text>
                    {usage.controlNumber ? <Text style={text.meta}>Control No. {usage.controlNumber}</Text> : null}
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${usage.itemName}`} hitSlop={8} onPress={() => removeUsage(usage.id)}>
                    <Text style={styles.remove}>Remove</Text>
                  </Pressable>
                </View>
              )) : <Text style={text.meta}>No inventory items added yet.</Text>}

              <SectionTitle title="Services by machine">
                <ActionButton compact variant="secondary" onPress={addService}>Price services</ActionButton>
              </SectionTitle>
              {report.machines.map((machine) => {
                const rows = report.machineServices.filter((service) => service.equipmentId === machine.equipmentId);
                return (
                  <View key={machine.equipmentId} style={styles.lineRow}>
                    <View style={styles.lineCopy}>
                      <Text style={text.bodyStrong}>
                        {[machine.machineType, machine.nicknameOrLocation || (machine.serialNumber ? `SN ${machine.serialNumber}` : '')].filter(Boolean).join(' · ')}
                      </Text>
                      {rows.length ? rows.map((row) => (
                        <Text key={row.id} style={text.meta}>{row.serviceName} · {formatCentavos(row.rateCentavos)}{row.note ? ` · ${row.note}` : ''}</Text>
                      )) : <Text style={text.meta}>No services yet.</Text>}
                    </View>
                    <Text style={text.amount}>{formatCentavos(rows.reduce((sum, row) => sum + row.rateCentavos, 0))}</Text>
                  </View>
                );
              })}

              <View style={styles.totalBox}>
                <View style={styles.lineCopy}>
                  <Text style={text.bodyStrong}>Total bill</Text>
                  <Text style={text.meta}>Billable items plus every per-machine service price. Non-billable items are excluded.</Text>
                </View>
                <Text style={styles.totalValue}>{formatCentavos(report.totalBillCentavos)}</Text>
              </View>

              <LinkedStatements statements={report.linkedStatements} />
              {hasLiveStatement ? null : (
                <ActionButton compact disabled={busy} variant="secondary" onPress={() => void createBillingDraft()}>Create linked Billing Statement draft</ActionButton>
              )}
            </View>
          </View>
        ) : (
          <>
            <View style={styles.facts}>
              <Fact label={report.machines.length > 1 ? 'Machines' : 'Machine'}>
                {report.machines.map((machine) => (
                  <Text key={machine.equipmentId} selectable style={text.body}>
                    {[machine.machineType, machine.model && `Model ${machine.model}`, machine.serialNumber && `Serial ${machine.serialNumber}`, machine.nicknameOrLocation].filter(Boolean).join(' · ')}
                  </Text>
                ))}
              </Fact>
              {report.documentState === 'finalized' ? (
                <Fact label="Billing statements">
                  <LinkedStatements statements={report.linkedStatements} bare />
                </Fact>
              ) : null}
              <Fact label="Serviced by / acknowledged by">{`${report.servicedBy || '—'} / ${report.acknowledgedBy || '—'}`}</Fact>
              {report.documentState === 'finalized' ? <Fact label="Signature status">{sentenceCase(report.signatureStatus)}</Fact> : null}
            </View>

            <View style={styles.readGrid}>
              <ReadBlock label="Reported problem" values={report.reportedProblem} />
              <ReadBlock label="Diagnosis" values={report.diagnosis} />
              <ReadBlock label="Action taken" values={report.actionTaken} />
              <ReadBlock label="Recommendations" values={report.recommendations} />
              <ReadBlock label="Machine status" values={[report.machineStatus]} />
              <ReadBlock label="Warranty" values={[report.warrantyText]} />
            </View>

            <SectionTitle title="Items used" />
            {report.usages.length ? (
              <Panel>
                <View style={[styles.tableRow, styles.tableHead]}>
                  <Text style={[text.label, styles.colMain]}>Item</Text>
                  <Text style={[text.label, styles.colControl]}>Control no.</Text>
                  <Text style={[text.label, styles.colQty]}>Qty</Text>
                  <Text style={[text.label, styles.colAmount]}>Amount</Text>
                </View>
                {report.usages.map((usage) => (
                  <View key={usage.id} style={[styles.tableRow, styles.tableDivider]}>
                    <Text selectable style={[text.body, styles.colMain]}>{usage.itemName}</Text>
                    <Text selectable style={[text.body, styles.colControl]}>{usage.controlNumber ?? '—'}</Text>
                    <Text style={[text.body, styles.colQty]}>{usage.quantity} {usage.unitLabel}</Text>
                    <Text style={[text.amount, styles.colAmount]}>
                      {usage.billable ? formatCentavos(usage.quantity * (usage.resolvedSellingPriceCentavos ?? 0)) : 'Non-billable'}
                    </Text>
                  </View>
                ))}
              </Panel>
            ) : <Text style={text.meta}>No items were used.</Text>}

            <SectionTitle title="Services" />
            {report.machineServices.length ? (
              <Panel>
                {report.machineServices.map((service, index) => (
                  <View key={service.id} style={[styles.tableRow, index > 0 ? styles.tableDivider : null]}>
                    <Text selectable style={[text.body, styles.colMain]}>{service.serviceName} · {service.machineLabel}</Text>
                    <Text style={[text.amount, styles.colAmount]}>{formatCentavos(service.rateCentavos)}</Text>
                  </View>
                ))}
              </Panel>
            ) : <Text style={text.meta}>No services were charged.</Text>}

            <View style={styles.totalBox}>
              <View style={styles.lineCopy}>
                <Text style={text.bodyStrong}>Total bill</Text>
                <Text style={text.meta}>Derived from billable inventory items and service rates.</Text>
              </View>
              <Text style={styles.totalValue}>{formatCentavos(report.totalBillCentavos)}</Text>
            </View>
            {report.documentState === 'finalized' && report.pdfState === 'ready' ? (
              <Text style={text.meta}>If this CSR has a finalized Billing Statement, it is sent as the following pages of the same PDF (CSR first).</Text>
            ) : null}
            <Text style={text.meta}>PDF {report.pdfState.replaceAll('_', ' ')} · {report.shareState === 'shared' ? 'share sheet opened' : 'not shared yet'}</Text>
          </>
        )}
      </ScrollView>
    </>
  );
}

/** Tappable list of the Billing Statements billed against this CSR. */
function LinkedStatements({ statements, bare = false }: { statements: ServiceReportDetail['linkedStatements']; bare?: boolean }) {
  if (!statements.length) return bare ? <Text style={text.meta}>No Billing Statement is linked to this CSR yet.</Text> : null;
  return (
    <View style={styles.linkedList}>
      {bare ? null : <Text style={text.label}>Linked billing statements</Text>}
      {statements.map((statement) => (
        <Pressable
          key={statement.id}
          accessibilityRole="link"
          accessibilityLabel={`Open ${statement.bsNumber ?? 'draft Billing Statement'}`}
          onPress={() => router.push({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': statement.id } })}
          style={({ pressed }) => [styles.linkedRow, pressed ? styles.pressed : null]}
        >
          <Text style={styles.link}>{statement.bsNumber ?? 'Draft Billing Statement'} ›</Text>
          <Text style={text.meta}>{sentenceCase(statement.documentState)} · {formatCentavos(statement.totalCentavos)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ReadBlock({ label, values }: { label: string; values: string[] }) {
  return (
    <View style={styles.readBlock}>
      <Text style={text.label}>{label}</Text>
      <Text selectable style={text.body}>{values.filter(Boolean).join('\n') || '—'}</Text>
    </View>
  );
}

function toForm(report: ServiceReportDetail): FormState {
  return { businessDate: report.businessDate, serviceOutcome: report.serviceOutcome, reportedProblem: report.reportedProblem.join('\n'), diagnosis: report.diagnosis.join('\n'), actionTaken: report.actionTaken.join('\n'), recommendations: report.recommendations.join('\n'), billing: report.billing.join('\n'), customerRemarks: report.customerRemarks.join('\n'), machineStatus: report.machineStatus, warrantyText: report.warrantyText, servicedBy: report.servicedBy, acknowledgedBy: report.acknowledgedBy };
}

function toDraftInput(form: FormState) {
  const lines = (value: string) => value.split('\n');
  return { businessDate: form.businessDate, serviceOutcome: form.serviceOutcome, reportedProblem: lines(form.reportedProblem), diagnosis: lines(form.diagnosis), actionTaken: lines(form.actionTaken), recommendations: lines(form.recommendations), billing: lines(form.billing), customerRemarks: lines(form.customerRemarks), machineStatus: form.machineStatus, warrantyText: form.warrantyText, servicedBy: form.servicedBy, acknowledgedBy: form.acknowledgedBy };
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.background },
  content: { gap: spacing.lg, padding: spacing.xxl, paddingBottom: 48 },
  columns: { gap: spacing.xxl },
  columnsWide: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { gap: spacing.md },
  formColumn: { flex: 5, minWidth: 0 },
  asideColumn: { flex: 4, minWidth: 0 },
  inlineFields: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  dateField: { flexBasis: 200, flexGrow: 1, maxWidth: 260 },
  outcomeField: { flexBasis: 320, flexGrow: 3, gap: 5 },
  segmented: { flexDirection: 'row', borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.control, overflow: 'hidden' },
  segment: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, backgroundColor: colors.surface },
  segmentDivider: { borderLeftWidth: 1, borderLeftColor: colors.inputBorder },
  segmentSelected: { backgroundColor: colors.primary },
  segmentText: { color: colors.tertiaryLabel, fontSize: fontSize.meta, fontWeight: '600', textAlign: 'center' },
  segmentTextSelected: { color: colors.onPrimary },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  gridField: { flexBasis: 260, flexGrow: 1, gap: 5 },
  multiline: { minHeight: 72 },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.control, backgroundColor: colors.surface },
  choiceSelected: { borderColor: colors.primary, backgroundColor: colors.accentTint },
  choiceTextSelected: { color: colors.brandNavy },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.separator },
  lineCopy: { flex: 1, minWidth: 0, gap: 2 },
  remove: { color: colors.error, fontSize: fontSize.meta, fontWeight: '600', paddingVertical: 10 },
  totalBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: radius.panel,
  },
  totalValue: { color: colors.label, fontSize: fontSize.section, fontWeight: '600', fontVariant: ['tabular-nums'] },
  linkedList: { gap: 4 },
  linkedRow: { minHeight: 44, justifyContent: 'center' },
  link: { color: colors.primary, fontSize: fontSize.body, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xl },
  readGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.separator },
  readBlock: { flexBasis: 220, flexGrow: 1, gap: 4 },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  tableHead: { paddingVertical: 8, backgroundColor: colors.subtleSurface },
  tableDivider: { borderTopWidth: 1, borderTopColor: colors.hairline },
  colMain: { flex: 1, minWidth: 0 },
  colControl: { width: 130 },
  colQty: { width: 70, textAlign: 'right' },
  colAmount: { width: 120, textAlign: 'right' },
});
