import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { DateField } from '@/components/date-field';
import { FormField } from '@/components/form-field';
import { getLocalBusinessDate } from '@/domain/business-date';
import { formatCentavos, parseCurrencyToCentavos } from '@/domain/money';
import { isQuotationExpired } from '@/domain/quotation';
import { getQuotationShareBundle, shareBundle } from '@/features/documents/share-bundle';
import { finalizeAndRenderQuotation, retryQuotationPdf } from '@/features/quotations/quotation-pdf';
import { deleteQuotationDraft, getQuotation, removeQuotationLine, updateQuotationDraft } from '@/features/quotations/quotation-repository';
import type { QuotationDetail, QuotationDiscountType } from '@/features/quotations/quotation-types';
import { getSignedPreviewTarget } from '@/features/signatures/signed-preview';
import { colors } from '@/theme/colors';

const DISCOUNT_CHOICES: Array<{ value: QuotationDiscountType; label: string }> = [
  { value: null, label: 'None' },
  { value: 'fixed', label: 'Fixed amount' },
  { value: 'percentage', label: 'Percentage' },
];

export default function QuotationDetailScreen() {
  const { 'quotation-id': quotationId } = useLocalSearchParams<{ 'quotation-id': string }>();
  const db = useSQLiteContext();
  const [quotation, setQuotation] = useState<QuotationDetail | null>(null);
  const [businessDate, setBusinessDate] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [discountType, setDiscountType] = useState<QuotationDiscountType>(null);
  const [discountValue, setDiscountValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!quotationId) return;
    try {
      const result = await getQuotation(db, quotationId);
      if (!result) throw new Error('Quotation was not found.');
      setQuotation(result);
      setBusinessDate(result.businessDate);
      setValidUntil(result.validUntil);
      setDiscountType(result.discountType);
      setDiscountValue(result.discountType ? (result.discountValue / 100).toFixed(2).replace(/\.00$/, '') : '');
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the quotation.');
    } finally {
      setLoading(false);
    }
  }, [db, quotationId]);

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

  const toDiscountValue = useCallback((): number => {
    if (!discountType) return 0;
    if (discountType === 'percentage') {
      const percent = Number(discountValue);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('Enter a percentage from 0 to 100.');
      return Math.round(percent * 100);
    }
    const centavos = parseCurrencyToCentavos(discountValue || '0');
    if (centavos === null) throw new Error('Enter the discount as an amount such as 500.00.');
    return centavos;
  }, [discountType, discountValue]);

  const saveDraft = useCallback(async () => {
    if (!quotationId) return;
    await updateQuotationDraft(db, quotationId, { businessDate, validUntil, discountType, discountValue: toDiscountValue() });
  }, [businessDate, db, discountType, quotationId, toDiscountValue, validUntil]);

  const openAddLine = useCallback(() => {
    void run(async () => {
      await saveDraft();
      router.push({ pathname: '/quotations/charge/new', params: { quotationId } });
    });
  }, [quotationId, run, saveDraft]);

  const previewDraft = useCallback(() => {
    void run(async () => {
      await saveDraft();
      router.push({ pathname: '/quotations/preview', params: { quotationId } });
    });
  }, [quotationId, run, saveDraft]);

  const finalize = useCallback(() => {
    Alert.alert('Finalize quotation?', 'This allocates the next QT number and freezes the quotation. Finalized quotations cannot be edited; void and reissue instead.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Finalize', onPress: () => void run(async () => { await saveDraft(); await finalizeAndRenderQuotation(db, quotationId!); }) },
    ]);
  }, [db, quotationId, run, saveDraft]);

  const removeDraft = useCallback(() => {
    Alert.alert('Delete draft?', 'This unnumbered quotation and its lines will be removed. No number or stock is affected.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteQuotationDraft(db, quotationId!).then(() => router.back()).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not delete the draft.')) },
    ]);
  }, [db, quotationId]);

  // Once signed, the preview shows the signed version instead of the plain PDF.
  const openPreview = useCallback(() => {
    void run(async () => {
      const target = quotation?.hasSignedVersion ? await getSignedPreviewTarget(db, 'quotation', quotationId!) : null;
      if (target?.kind === 'capture') router.push({ pathname: '/signatures/preview', params: { captureId: target.captureId, kind: 'quotation', ownerId: quotationId } });
      else if (target?.kind === 'attachment') await Print.printAsync({ uri: target.uri });
      else router.push({ pathname: '/quotations/preview', params: { quotationId } });
    });
  }, [db, quotation?.hasSignedVersion, quotationId, run]);

  if (loading && !quotation) return <View style={styles.centered}><ActivityIndicator color={colors.brandBlue} size="large" /></View>;
  if (!quotation) return <View style={styles.centered}><Text selectable style={styles.error}>{error ?? 'Quotation was not found.'}</Text></View>;

  const draft = quotation.documentState === 'draft';
  const finalized = quotation.documentState === 'finalized';
  const discount = quotation.subtotalCentavos - quotation.totalCentavos;
  const expired = finalized && !quotation.convertedKind && isQuotationExpired(quotation.validUntil, getLocalBusinessDate());
  const goSigning = (mode: 'sign' | 'import') => router.push({ pathname: '/signatures/manage', params: { ownerType: 'quotation', ownerId: quotationId, mode } });

  return (
    <>
      <Stack.Screen options={{ title: quotation.qtNumber ?? 'Quotation draft' }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View>
            <Text selectable style={styles.eyebrow}>{quotation.documentState.toUpperCase()}</Text>
            <Text selectable style={styles.number}>{quotation.qtNumber ?? 'Unnumbered draft'}</Text>
          </View>
          <Text selectable style={styles.heroTotal}>{formatCentavos(quotation.totalCentavos)}</Text>
        </View>

        <View style={styles.card}>
          <Label label="Customer" value={quotation.customerName} />
          <Label label="Date" value={quotation.businessDate} />
          <Label label="Valid until" value={quotation.validUntil} />
          {expired ? <Text selectable style={styles.warning}>This quotation has expired. It can still be converted if the customer accepts it now.</Text> : null}
        </View>

        {error ? <Text selectable style={styles.error}>{error}</Text> : null}

        {draft ? (
          <View style={styles.card}>
            <Text selectable style={styles.sectionTitle}>Draft details</Text>
            <DateField label="Quotation date" value={businessDate} onChange={setBusinessDate} />
            <DateField label="Valid until" value={validUntil} minDate={businessDate} allowFuture onChange={setValidUntil} />
            <Text selectable style={styles.fieldLabel}>Discount</Text>
            <View style={styles.pills}>
              {DISCOUNT_CHOICES.map((choice) => (
                <Pressable key={choice.label} accessibilityRole="button" onPress={() => { setDiscountType(choice.value); setDiscountValue(''); }} style={[styles.pill, discountType === choice.value ? styles.activePill : null]}>
                  <Text style={[styles.pillText, discountType === choice.value ? styles.activePillText : null]}>{choice.label}</Text>
                </Pressable>
              ))}
            </View>
            {discountType ? <FormField keyboardType="decimal-pad" label={discountType === 'percentage' ? 'Discount percent' : 'Discount amount'} onChangeText={setDiscountValue} value={discountValue} /> : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text selectable style={styles.sectionTitle}>Items and services</Text>
            {draft ? <ActionButton compact disabled={busy} onPress={openAddLine}>Add</ActionButton> : null}
          </View>
          {quotation.lines.length ? quotation.lines.map((line) => (
            <View key={line.id} style={styles.line}>
              <View style={styles.lineCopy}>
                <Text selectable style={styles.lineTitle}>{line.description}</Text>
                <Text selectable style={styles.help}>{line.lineType.toUpperCase()} · {line.quantity} × {formatCentavos(line.unitPriceCentavos)}{line.priceSource === 'override' ? ` · custom price (${line.overrideReason})` : ''}</Text>
              </View>
              <Text selectable style={styles.lineTitle}>{formatCentavos(line.amountCentavos)}</Text>
              {draft ? <Pressable accessibilityRole="button" onPress={() => void run(() => removeQuotationLine(db, quotation.id, line.id))}><Text selectable style={styles.remove}>REMOVE</Text></Pressable> : null}
            </View>
          )) : <Text selectable style={styles.help}>No items or services yet.</Text>}
        </View>

        <View style={styles.totals}>
          <Label label="Subtotal" value={formatCentavos(quotation.subtotalCentavos)} />
          {discount > 0 ? <Label label="Discount" value={`− ${formatCentavos(discount)}`} /> : null}
          <View style={styles.grand}>
            <Text selectable style={styles.grandLabel}>TOTAL</Text>
            <Text selectable style={styles.grandValue}>{formatCentavos(quotation.totalCentavos)}</Text>
          </View>
        </View>

        {draft ? (
          <View style={styles.actions}>
            <ActionButton disabled={busy} variant="secondary" onPress={previewDraft}>Preview PDF before finalizing</ActionButton>
            <ActionButton disabled={busy || !quotation.lines.length} onPress={finalize}>Finalize quotation</ActionButton>
            <ActionButton disabled={busy} variant="danger" onPress={removeDraft}>Delete draft</ActionButton>
          </View>
        ) : null}

        {finalized ? (
          <>
            <View style={styles.card}>
              <Label label="Signature status" value={quotation.signatureStatus.replaceAll('_', ' ')} />
              {quotation.hasSignedVersion ? null : <ActionButton disabled={busy} variant="secondary" onPress={() => goSigning('sign')}>Sign quotation</ActionButton>}
              <ActionButton disabled={busy} variant="secondary" onPress={() => goSigning('import')}>Import signed PDF</ActionButton>
            </View>
            <View style={styles.actions}>
              <ActionButton disabled={busy} variant="secondary" onPress={openPreview}>{quotation.hasSignedVersion ? 'Preview signed quotation' : 'Preview quotation'}</ActionButton>
              {quotation.pdfState === 'ready'
                ? <ActionButton disabled={busy} onPress={() => void run(async () => { await shareBundle(db, await getQuotationShareBundle(db, quotation.id)); })}>Share quotation PDF</ActionButton>
                : <ActionButton disabled={busy} onPress={() => void run(() => retryQuotationPdf(db, quotation.id))}>Retry quotation PDF</ActionButton>}
              {quotation.convertedKind ? null : <ActionButton disabled={busy} variant="danger" onPress={() => router.push({ pathname: '/quotations/void', params: { quotationId: quotation.id } })}>Void quotation</ActionButton>}
            </View>
          </>
        ) : null}

        {quotation.documentState === 'voided' ? <Text selectable style={styles.warning}>This quotation was voided. It stays on record and cannot be edited or converted.</Text> : null}
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
  fieldLabel: { color: colors.label, fontSize: 14, fontWeight: '700' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: colors.separator, borderRadius: 20, backgroundColor: colors.surface },
  activePill: { borderColor: colors.brandBlue, backgroundColor: '#eaf2ff' },
  pillText: { color: colors.secondaryLabel, fontSize: 12, fontWeight: '800' },
  activePillText: { color: colors.brandNavy },
  section: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  lineCopy: { flex: 1, gap: 3 },
  lineTitle: { color: colors.label, fontSize: 14, fontWeight: '800' },
  help: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 17 },
  remove: { color: colors.error, fontSize: 10, fontWeight: '900' },
  totals: { gap: 8, padding: 16, backgroundColor: colors.surface, borderRadius: 16, borderCurve: 'continuous' },
  grand: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.separator },
  grandLabel: { color: colors.label, fontSize: 13, fontWeight: '900' },
  grandValue: { color: colors.brandNavy, fontSize: 18, fontWeight: '900' },
  actions: { gap: 10 },
  warning: { color: colors.warning, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  error: { color: colors.error, fontSize: 13, fontWeight: '600' },
});
