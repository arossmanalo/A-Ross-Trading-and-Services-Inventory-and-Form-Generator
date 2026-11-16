import { Stack, router, useFocusEffect } from 'expo-router';
import * as Print from 'expo-print';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
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
import { finalizeAndRenderDelivery, retryDeliveryPdf } from '@/features/deliveries/delivery-pdf';
import { deleteDeliveryDraft, getDelivery, removeDeliveryLine, updateDeliveryDraft, updateDeliveryLineQuantity } from '@/features/deliveries/delivery-repository';
import type { DeliveryDetail } from '@/features/deliveries/delivery-types';
import { getDeliveryShareBundle, shareBundle } from '@/features/documents/share-bundle';
import { getSignedPreviewTarget } from '@/features/signatures/signed-preview';
import { colors } from '@/theme/colors';
import { fontSize, radius, spacing, text } from '@/theme/typography';

type DeliveryDetailViewProps = {
  deliveryId: string;
  embedded?: boolean;
  onDeleted?: () => void;
  onChanged?: () => void;
};

export function DeliveryDetailView({ deliveryId, embedded = false, onDeleted, onChanged }: DeliveryDetailViewProps) {
  const db = useSQLiteContext();
  const [delivery, setDelivery] = useState<DeliveryDetail | null>(null);
  const [businessDate, setBusinessDate] = useState('');
  const [deliveredBy, setDeliveredBy] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getDelivery(db, deliveryId);
      if (!result) throw new Error('Delivery was not found.');
      setDelivery(result);
      setBusinessDate(result.businessDate);
      setDeliveredBy(result.deliveredBy);
      setReceivedBy(result.receivedBy);
      setNotes(result.notes);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the delivery.');
    } finally {
      setLoading(false);
    }
  }, [db, deliveryId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'That action failed.');
    } finally {
      setBusy(false);
    }
  }, [load]);

  const saveDraft = useCallback(async () => {
    await updateDeliveryDraft(db, deliveryId, { businessDate, deliveredBy, receivedBy, notes });
  }, [businessDate, db, deliveredBy, deliveryId, notes, receivedBy]);

  const addItem = useCallback(() => {
    void run(async () => {
      await saveDraft();
      router.push({ pathname: '/deliveries/item/new', params: { deliveryId } });
    });
  }, [deliveryId, run, saveDraft]);

  const previewDraft = useCallback(() => {
    void run(async () => {
      await saveDraft();
      router.push({ pathname: '/deliveries/preview', params: { deliveryId } });
    });
  }, [deliveryId, run, saveDraft]);

  const finalize = useCallback(() => {
    Alert.alert('Finalize delivery?', 'This allocates the next DF number and deducts the delivered quantities from stock. A finalized delivery cannot be edited; void it to correct it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Finalize',
        onPress: () => void run(async () => {
          await saveDraft();
          await finalizeAndRenderDelivery(db, deliveryId);
          onChanged?.();
        }),
      },
    ]);
  }, [db, deliveryId, onChanged, run, saveDraft]);

  const removeDraft = useCallback(() => {
    Alert.alert('Delete draft?', 'This unnumbered delivery and its lines will be removed. No number or stock is affected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void deleteDeliveryDraft(db, deliveryId)
          .then(() => (onDeleted ? onDeleted() : router.back()))
          .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not delete the draft.')),
      },
    ]);
  }, [db, deliveryId, onDeleted]);

  // Once signed, the preview shows the signed version instead of the plain form.
  const openPreview = useCallback(() => {
    void run(async () => {
      const target = delivery?.hasSignedVersion ? await getSignedPreviewTarget(db, 'delivery', deliveryId) : null;
      if (target?.kind === 'capture') router.push({ pathname: '/signatures/preview', params: { captureId: target.captureId, kind: 'delivery', ownerId: deliveryId } });
      else if (target?.kind === 'attachment') await Print.printAsync({ uri: target.uri });
      else router.push({ pathname: '/deliveries/preview', params: { deliveryId } });
    });
  }, [db, delivery?.hasSignedVersion, deliveryId, run]);

  const createStatement = useCallback(() => {
    if (!delivery) return;
    void run(async () => {
      const statementId = await createBillingStatementDraft(db, { customerId: delivery.customerId, deliveryId: delivery.id, businessDate: getLocalBusinessDate(), reuseExistingLinkedDraft: true });
      router.push({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': statementId } });
    });
  }, [db, delivery, run]);

  if (loading && !delivery) return <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>;
  if (!delivery) return <View style={styles.centered}><Text selectable style={text.error}>{error ?? 'Delivery was not found.'}</Text></View>;

  const draft = delivery.documentState === 'draft';
  const finalized = delivery.documentState === 'finalized';
  const shortages = draft ? delivery.lines.filter((line) => line.quantity > line.currentStock) : [];
  const goSigning = (mode: 'sign' | 'import') => router.push({ pathname: '/signatures/manage', params: { ownerType: 'delivery', ownerId: deliveryId, mode } });
  const title = delivery.dfNumber ?? 'Delivery draft';

  return (
    <>
      {embedded ? null : <Stack.Screen options={{ title }} />}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <RecordHeader
          title={title}
          chips={<StatusChip label={draft ? 'Not numbered yet' : sentenceCase(delivery.documentState)} tone={documentStateTone(delivery.documentState)} />}
          subtitle={`${delivery.customerName} · ${formatDisplayDate(delivery.businessDate)}`}
          actions={draft ? (
            <>
              <ActionButton compact disabled={busy} variant="danger" onPress={removeDraft}>Delete draft</ActionButton>
              <ActionButton compact disabled={busy} variant="secondary" onPress={previewDraft}>Preview form</ActionButton>
              <ActionButton compact disabled={busy || !delivery.lines.length} onPress={finalize}>Finalize delivery</ActionButton>
            </>
          ) : finalized ? (
            <>
              <ActionButton compact disabled={busy} variant="secondary" onPress={openPreview}>
                {delivery.hasSignedVersion ? 'Preview signed form' : 'Preview delivery form'}
              </ActionButton>
              {delivery.pdfState === 'ready'
                ? <ActionButton compact disabled={busy} onPress={() => void run(async () => { await shareBundle(db, await getDeliveryShareBundle(db, delivery.id)); })}>Share delivery PDF</ActionButton>
                : <ActionButton compact disabled={busy} onPress={() => void run(() => retryDeliveryPdf(db, delivery.id))}>Retry delivery PDF</ActionButton>}
              {finalized ? (
                <ActionMenu
                  actions={[
                    !delivery.hasSignedVersion && { label: 'Sign delivery form', note: 'Capture or record signatures', onPress: () => goSigning('sign'), disabled: busy },
                    { label: 'Import signed PDF', note: "The customer's signed copy", onPress: () => goSigning('import'), disabled: busy },
                    !delivery.linkedStatements.length && { label: 'Create Billing Statement', onPress: createStatement, disabled: busy },
                    {
                      label: 'Void delivery',
                      note: 'Needs a reason',
                      destructive: true,
                      disabled: busy,
                      onPress: () => router.push({ pathname: '/deliveries/void', params: { deliveryId: delivery.id } }),
                    },
                  ]}
                />
              ) : null}
            </>
          ) : null}
        />

        {error ? <Text accessibilityLiveRegion="polite" selectable style={text.error}>{error}</Text> : null}
        {delivery.documentState === 'voided' ? (
          <View style={styles.voidNotice}>
            <Text style={[text.body, styles.voidText]}>This delivery was voided{delivery.voidReason ? `: ${delivery.voidReason}` : ''}. It stays on record.</Text>
          </View>
        ) : null}

        {draft ? (
          <View style={styles.draftFields}>
            <View style={styles.field}><DateField label="Delivery date" value={businessDate} onChange={setBusinessDate} /></View>
            <FormField containerStyle={styles.field} autoCapitalize="words" label="Delivered by" onChangeText={setDeliveredBy} value={deliveredBy} />
            <FormField containerStyle={styles.field} autoCapitalize="words" label="Received by" onChangeText={setReceivedBy} value={receivedBy} />
            <FormField containerStyle={styles.notesField} label="Notes" multiline onChangeText={setNotes} style={styles.notes} textAlignVertical="top" value={notes} />
            <Text style={text.meta}>Changes here are saved when you add an item, preview or finalize.</Text>
          </View>
        ) : (
          <View style={styles.facts}>
            <Fact label="Delivered by">{delivery.deliveredBy || '—'}</Fact>
            <Fact label="Received by">{delivery.receivedBy || '—'}</Fact>
            {finalized ? <Fact label="Signature status">{sentenceCase(delivery.signatureStatus)}</Fact> : null}
            {delivery.notes ? <Fact label="Notes">{delivery.notes}</Fact> : null}
          </View>
        )}

        <SectionTitle title="Items delivered">
          {draft ? <ActionButton compact disabled={busy} variant="secondary" onPress={addItem}>Add item</ActionButton> : null}
        </SectionTitle>
        {delivery.lines.length ? (
          <Panel>
            {delivery.lines.map((line, index) => (
              <View key={line.id} style={[styles.lineRow, index > 0 ? styles.lineDivider : null]}>
                <View style={styles.lineCopy}>
                  <Text selectable style={text.bodyStrong}>{line.description}</Text>
                  <Text style={text.meta}>
                    {line.quantity} {line.unitLabel} × {formatCentavos(line.unitPriceCentavos)}{line.priceSource === 'override' ? ` · custom price (${line.overrideReason})` : ''}
                  </Text>
                  {draft && line.quantity > line.currentStock ? <Text style={styles.shortage}>Only {line.currentStock} in stock</Text> : null}
                </View>
                {draft ? (
                  <View style={styles.stepper}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Decrease ${line.description}`}
                      disabled={busy || line.quantity <= 1}
                      onPress={() => void run(() => updateDeliveryLineQuantity(db, delivery.id, line.id, line.quantity - 1))}
                      style={[styles.stepButton, busy || line.quantity <= 1 ? styles.stepDisabled : null]}
                    >
                      <Text style={styles.stepText}>−</Text>
                    </Pressable>
                    <Text style={styles.stepValue}>{line.quantity}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Increase ${line.description}`}
                      disabled={busy}
                      onPress={() => void run(() => updateDeliveryLineQuantity(db, delivery.id, line.id, line.quantity + 1))}
                      style={[styles.stepButton, busy ? styles.stepDisabled : null]}
                    >
                      <Text style={styles.stepText}>+</Text>
                    </Pressable>
                  </View>
                ) : null}
                <Text style={[text.amount, styles.lineAmount]}>{formatCentavos(line.amountCentavos)}</Text>
                {draft ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${line.description}`} disabled={busy} hitSlop={8} onPress={() => void run(() => removeDeliveryLine(db, delivery.id, line.id))}>
                    <Text style={styles.remove}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </Panel>
        ) : <Text style={text.meta}>No items yet. Use Add item to choose what is being delivered.</Text>}

        {shortages.length ? (
          <View style={styles.shortNotice}>
            <Text style={styles.shortNoticeText}>Stock is short for {shortages.map((line) => line.description).join(', ')}. Reduce the quantity or restock before finalizing.</Text>
          </View>
        ) : null}

        <View style={styles.valueRow}>
          <Text style={[text.meta, styles.valueNote]}>The delivery form prints these prices and the total, so it can serve as the bill.</Text>
          <Text style={text.meta}>Value delivered</Text>
          <Text style={styles.valueAmount}>{formatCentavos(delivery.totalCentavos)}</Text>
        </View>

        {delivery.linkedStatements.length ? (
          <View style={styles.linked}>
            <Text style={text.label}>Billing Statement</Text>
            {delivery.linkedStatements.map((statement) => (
              <Pressable
                key={statement.id}
                accessibilityRole="link"
                accessibilityLabel={`Open ${statement.bsNumber ?? 'draft Billing Statement'}`}
                onPress={() => router.push({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': statement.id } })}
                style={styles.linkRow}
              >
                <Text style={styles.linkText}>{statement.bsNumber ?? 'Draft statement'} ›</Text>
                <Text style={text.meta}>{sentenceCase(statement.documentState)} · {formatCentavos(statement.totalCentavos)}</Text>
              </Pressable>
            ))}
            {finalized && delivery.pdfState === 'ready' ? <Text style={text.meta}>A finalized statement is sent in the same PDF, after this delivery form.</Text> : null}
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  content: { gap: spacing.lg, padding: spacing.xxl, paddingBottom: 48 },
  voidNotice: { padding: spacing.md, borderRadius: radius.control, backgroundColor: colors.errorTint },
  voidText: { color: colors.error },
  draftFields: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  field: { flexBasis: 200, flexGrow: 1 },
  notesField: { flexBasis: '100%', gap: 5 },
  notes: { minHeight: 72 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xl },
  lineRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  lineDivider: { borderTopWidth: 1, borderTopColor: colors.hairline },
  lineCopy: { flex: 1, minWidth: 180, gap: 2 },
  shortage: { color: colors.warning, fontSize: fontSize.meta, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.control, overflow: 'hidden' },
  stepButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.subtleSurface },
  stepDisabled: { opacity: 0.4 },
  stepText: { color: colors.label, fontSize: fontSize.section },
  stepValue: { minWidth: 40, textAlign: 'center', color: colors.label, fontSize: fontSize.body, fontWeight: '600', fontVariant: ['tabular-nums'] },
  lineAmount: { width: 110, textAlign: 'right' },
  remove: { color: colors.error, fontSize: fontSize.meta, fontWeight: '600', paddingVertical: 10 },
  shortNotice: { padding: spacing.md, borderRadius: radius.control, backgroundColor: colors.warningTint, borderWidth: 1, borderColor: colors.warningBorder },
  shortNoticeText: { color: colors.warning, fontSize: fontSize.meta, fontWeight: '600' },
  valueRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'flex-end', gap: spacing.sm },
  valueNote: { flex: 1, minWidth: 240 },
  valueAmount: { color: colors.label, fontSize: fontSize.section, fontWeight: '600', fontVariant: ['tabular-nums'] },
  linked: { gap: 4, paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.separator },
  linkRow: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: colors.primary, fontSize: fontSize.body, fontWeight: '600' },
});
