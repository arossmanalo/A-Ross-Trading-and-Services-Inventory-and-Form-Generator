import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { DateField } from '@/components/date-field';
import { FormField } from '@/components/form-field';
import { getLocalBusinessDate } from '@/domain/business-date';
import { formatCentavos } from '@/domain/money';
import { createBillingStatementDraft } from '@/features/billing-statements/billing-statement-repository';
import { finalizeAndRenderDelivery, retryDeliveryPdf } from '@/features/deliveries/delivery-pdf';
import { deleteDeliveryDraft, getDelivery, removeDeliveryLine, updateDeliveryDraft, updateDeliveryLineQuantity } from '@/features/deliveries/delivery-repository';
import type { DeliveryDetail } from '@/features/deliveries/delivery-types';
import { getDeliveryShareBundle, shareBundle } from '@/features/documents/share-bundle';
import { getSignedPreviewTarget } from '@/features/signatures/signed-preview';
import { colors } from '@/theme/colors';

export default function DeliveryDetailScreen() {
  const { 'delivery-id': deliveryId } = useLocalSearchParams<{ 'delivery-id': string }>();
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
    if (!deliveryId) return;
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
    if (!deliveryId) return;
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
      { text: 'Finalize', onPress: () => void run(async () => { await saveDraft(); await finalizeAndRenderDelivery(db, deliveryId!); }) },
    ]);
  }, [db, deliveryId, run, saveDraft]);

  const removeDraft = useCallback(() => {
    Alert.alert('Delete draft?', 'This unnumbered delivery and its lines will be removed. No number or stock is affected.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteDeliveryDraft(db, deliveryId!).then(() => router.back()).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not delete the draft.')) },
    ]);
  }, [db, deliveryId]);

  // Once signed, the preview shows the signed version instead of the plain form.
  const openPreview = useCallback(() => {
    void run(async () => {
      const target = delivery?.hasSignedVersion ? await getSignedPreviewTarget(db, 'delivery', deliveryId!) : null;
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

  if (loading && !delivery) return <View style={styles.centered}><ActivityIndicator color={colors.brandBlue} size="large" /></View>;
  if (!delivery) return <View style={styles.centered}><Text selectable style={styles.error}>{error ?? 'Delivery was not found.'}</Text></View>;

  const draft = delivery.documentState === 'draft';
  const finalized = delivery.documentState === 'finalized';
  const shortages = draft ? delivery.lines.filter((line) => line.quantity > line.currentStock) : [];
  const goSigning = (mode: 'sign' | 'import') => router.push({ pathname: '/signatures/manage', params: { ownerType: 'delivery', ownerId: deliveryId, mode } });

  return (
    <>
      <Stack.Screen options={{ title: delivery.dfNumber ?? 'Delivery draft' }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View>
            <Text selectable style={styles.eyebrow}>{delivery.documentState.toUpperCase()}</Text>
            <Text selectable style={styles.number}>{delivery.dfNumber ?? 'Unnumbered draft'}</Text>
          </View>
          <Text selectable style={styles.heroTotal}>{formatCentavos(delivery.totalCentavos)}</Text>
        </View>

        <View style={styles.card}>
          <Label label="Customer" value={delivery.customerName} />
          <Label label="Date" value={delivery.businessDate} />
          {delivery.deliveredBy ? <Label label="Delivered by" value={delivery.deliveredBy} /> : null}
          {delivery.receivedBy ? <Label label="Received by" value={delivery.receivedBy} /> : null}
          {delivery.notes && !draft ? <Label label="Notes" value={delivery.notes} /> : null}
        </View>

        {error ? <Text selectable style={styles.error}>{error}</Text> : null}

        {draft ? (
          <View style={styles.card}>
            <Text selectable style={styles.sectionTitle}>Draft details</Text>
            <DateField label="Delivery date" value={businessDate} onChange={setBusinessDate} />
            <FormField autoCapitalize="words" label="Delivered by" onChangeText={setDeliveredBy} value={deliveredBy} />
            <FormField autoCapitalize="words" label="Received by" onChangeText={setReceivedBy} value={receivedBy} />
            <FormField label="Notes" multiline onChangeText={setNotes} style={styles.notes} textAlignVertical="top" value={notes} />
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text selectable style={styles.sectionTitle}>Items delivered</Text>
            {draft ? <ActionButton compact disabled={busy} onPress={addItem}>Add item</ActionButton> : null}
          </View>
          {delivery.lines.length ? delivery.lines.map((line) => (
            <View key={line.id} style={styles.line}>
              <View style={styles.lineCopy}>
                <Text selectable style={styles.lineTitle}>{line.description}</Text>
                <Text selectable style={styles.help}>{line.quantity} {line.unitLabel} × {formatCentavos(line.unitPriceCentavos)}{line.priceSource === 'override' ? ` · custom price (${line.overrideReason})` : ''}</Text>
                {draft && line.quantity > line.currentStock ? <Text selectable style={styles.warning}>Only {line.currentStock} in stock</Text> : null}
              </View>
              <Text selectable style={styles.lineTitle}>{formatCentavos(line.amountCentavos)}</Text>
              {draft ? (
                <View style={styles.stepper}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${line.description}`} disabled={busy || line.quantity <= 1} onPress={() => void run(() => updateDeliveryLineQuantity(db, delivery.id, line.id, line.quantity - 1))} style={styles.stepButton}><Text style={styles.stepText}>−</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${line.description}`} disabled={busy} onPress={() => void run(() => updateDeliveryLineQuantity(db, delivery.id, line.id, line.quantity + 1))} style={styles.stepButton}><Text style={styles.stepText}>+</Text></Pressable>
                  <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(() => removeDeliveryLine(db, delivery.id, line.id))}><Text selectable style={styles.remove}>REMOVE</Text></Pressable>
                </View>
              ) : null}
            </View>
          )) : <Text selectable style={styles.help}>No items yet.</Text>}
        </View>

        <View style={styles.totals}>
          <View style={styles.grand}>
            <Text selectable style={styles.grandLabel}>VALUE DELIVERED</Text>
            <Text selectable style={styles.grandValue}>{formatCentavos(delivery.totalCentavos)}</Text>
          </View>
          <Text selectable style={styles.help}>Prices are kept for billing and are not printed on the delivery form.</Text>
        </View>

        {delivery.linkedStatements.length ? (
          <View style={styles.card}>
            <Text selectable style={styles.sectionTitle}>Billing Statement</Text>
            {delivery.linkedStatements.map((statement) => (
              <Pressable key={statement.id} accessibilityRole="link" accessibilityLabel={`Open ${statement.bsNumber ?? 'draft Billing Statement'}`} onPress={() => router.push({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': statement.id } })} style={styles.linkedRow}>
                <Text selectable style={styles.lineTitle}>{statement.bsNumber ?? 'Draft statement'} ›</Text>
                <Text selectable style={styles.help}>{statement.documentState} · {formatCentavos(statement.totalCentavos)}</Text>
              </Pressable>
            ))}
            {finalized && delivery.pdfState === 'ready' ? <Text selectable style={styles.help}>A finalized statement is sent in the same PDF, after this delivery form.</Text> : null}
          </View>
        ) : null}

        {draft ? (
          <View style={styles.actions}>
            {shortages.length ? <Text selectable style={styles.warning}>Stock is short for {shortages.map((line) => line.description).join(', ')}. Reduce the quantity or restock before finalizing.</Text> : null}
            <ActionButton disabled={busy} variant="secondary" onPress={previewDraft}>Preview form before finalizing</ActionButton>
            <ActionButton disabled={busy || !delivery.lines.length} onPress={finalize}>Finalize delivery</ActionButton>
            <ActionButton disabled={busy} variant="danger" onPress={removeDraft}>Delete draft</ActionButton>
          </View>
        ) : null}

        {finalized ? (
          <>
            <View style={styles.card}>
              <Label label="Signature status" value={delivery.signatureStatus.replaceAll('_', ' ')} />
              {delivery.hasSignedVersion ? null : <ActionButton disabled={busy} variant="secondary" onPress={() => goSigning('sign')}>Sign delivery form</ActionButton>}
              <ActionButton disabled={busy} variant="secondary" onPress={() => goSigning('import')}>Import signed PDF</ActionButton>
            </View>
            <View style={styles.actions}>
              <ActionButton disabled={busy} variant="secondary" onPress={openPreview}>{delivery.hasSignedVersion ? 'Preview signed delivery form' : 'Preview delivery form'}</ActionButton>
              {delivery.pdfState === 'ready'
                ? <ActionButton disabled={busy} onPress={() => void run(async () => { await shareBundle(db, await getDeliveryShareBundle(db, delivery.id)); })}>Share delivery PDF</ActionButton>
                : <ActionButton disabled={busy} onPress={() => void run(() => retryDeliveryPdf(db, delivery.id))}>Retry delivery PDF</ActionButton>}
              {delivery.linkedStatements.length ? null : <ActionButton disabled={busy} onPress={createStatement}>Create Billing Statement</ActionButton>}
              <ActionButton disabled={busy} variant="danger" onPress={() => router.push({ pathname: '/deliveries/void', params: { deliveryId: delivery.id } })}>Void delivery</ActionButton>
            </View>
          </>
        ) : null}

        {delivery.documentState === 'voided' ? <Text selectable style={styles.warning}>This delivery was voided{delivery.voidReason ? `: ${delivery.voidReason}` : ''}. It stays on record.</Text> : null}
      </ScrollView>
    </>
  );
}

function Label({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.labelRow}>
      <Text selectable style={styles.label}>{label}</Text>
      <Text selectable style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, padding: 18, paddingBottom: 44 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hero: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 19, backgroundColor: colors.brandNavy, borderRadius: 20, borderCurve: 'continuous' },
  eyebrow: { color: '#a9c9f5', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  number: { color: '#fff', fontSize: 20, fontWeight: '900' },
  heroTotal: { color: '#fff', fontSize: 24, fontWeight: '900' },
  card: { gap: 12, padding: 16, backgroundColor: colors.surface, borderRadius: 16, borderCurve: 'continuous' },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 14 },
  label: { color: colors.secondaryLabel, fontSize: 12, fontWeight: '700' },
  value: { flex: 1, color: colors.label, fontSize: 12, fontWeight: '800', textAlign: 'right' },
  sectionTitle: { color: colors.label, fontSize: 17, fontWeight: '900' },
  notes: { minHeight: 72 },
  section: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  linkedRow: { gap: 3, paddingVertical: 6 },
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  lineCopy: { flex: 1, minWidth: 160, gap: 3 },
  lineTitle: { color: colors.label, fontSize: 14, fontWeight: '800' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.separator, borderRadius: 20, backgroundColor: colors.surface },
  stepText: { color: colors.brandBlue, fontSize: 20, fontWeight: '800' },
  help: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 17 },
  remove: { color: colors.error, fontSize: 10, fontWeight: '900' },
  totals: { gap: 8, padding: 16, backgroundColor: colors.surface, borderRadius: 16, borderCurve: 'continuous' },
  grand: { flexDirection: 'row', justifyContent: 'space-between' },
  grandLabel: { color: colors.label, fontSize: 13, fontWeight: '900' },
  grandValue: { color: colors.brandNavy, fontSize: 18, fontWeight: '900' },
  actions: { gap: 10 },
  warning: { color: colors.warning, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  error: { color: colors.error, fontSize: 13, fontWeight: '600' },
});
