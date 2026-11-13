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
import { formatCentavos, parseCurrencyToCentavos } from '@/domain/money';
import { isQuotationExpired } from '@/domain/quotation';
import { getQuotationShareBundle, shareBundle } from '@/features/documents/share-bundle';
import { finalizeAndRenderQuotation, retryQuotationPdf } from '@/features/quotations/quotation-pdf';
import { deleteQuotationDraft, getQuotation, removeQuotationLine, updateQuotationDraft } from '@/features/quotations/quotation-repository';
import type { QuotationDetail, QuotationDiscountType } from '@/features/quotations/quotation-types';
import { getSignedPreviewTarget } from '@/features/signatures/signed-preview';
import { colors } from '@/theme/colors';
import { fontSize, radius, spacing, text } from '@/theme/typography';

const DISCOUNT_CHOICES: Array<{ value: QuotationDiscountType; label: string }> = [
  { value: null, label: 'None' },
  { value: 'fixed', label: 'Fixed amount' },
  { value: 'percentage', label: 'Percentage' },
];

type QuotationDetailViewProps = {
  quotationId: string;
  embedded?: boolean;
  onDeleted?: () => void;
  onChanged?: () => void;
};

export function QuotationDetailView({ quotationId, embedded = false, onDeleted, onChanged }: QuotationDetailViewProps) {
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
      {
        text: 'Finalize',
        onPress: () => void run(async () => {
          await saveDraft();
          await finalizeAndRenderQuotation(db, quotationId);
          onChanged?.();
        }),
      },
    ]);
  }, [db, onChanged, quotationId, run, saveDraft]);

  const removeDraft = useCallback(() => {
    Alert.alert('Delete draft?', 'This unnumbered quotation and its lines will be removed. No number or stock is affected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void deleteQuotationDraft(db, quotationId)
          .then(() => (onDeleted ? onDeleted() : router.back()))
          .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not delete the draft.')),
      },
    ]);
  }, [db, onDeleted, quotationId]);

  // Once signed, the preview shows the signed version instead of the plain PDF.
  const openPreview = useCallback(() => {
    void run(async () => {
      const target = quotation?.hasSignedVersion ? await getSignedPreviewTarget(db, 'quotation', quotationId) : null;
      if (target?.kind === 'capture') router.push({ pathname: '/signatures/preview', params: { captureId: target.captureId, kind: 'quotation', ownerId: quotationId } });
      else if (target?.kind === 'attachment') await Print.printAsync({ uri: target.uri });
      else router.push({ pathname: '/quotations/preview', params: { quotationId } });
    });
  }, [db, quotation?.hasSignedVersion, quotationId, run]);

  if (loading && !quotation) return <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>;
  if (!quotation) return <View style={styles.centered}><Text selectable style={text.error}>{error ?? 'Quotation was not found.'}</Text></View>;

  const draft = quotation.documentState === 'draft';
  const finalized = quotation.documentState === 'finalized';
  const discount = quotation.subtotalCentavos - quotation.totalCentavos;
  const expired = finalized && !quotation.convertedKind && isQuotationExpired(quotation.validUntil, getLocalBusinessDate());
  const goSigning = (mode: 'sign' | 'import') => router.push({ pathname: '/signatures/manage', params: { ownerType: 'quotation', ownerId: quotationId, mode } });
  const title = quotation.qtNumber ?? 'Quotation draft';
  const convertedServiceReportId = quotation.convertedServiceReportId;
  const convertedDeliveryId = quotation.convertedDeliveryId;
  const convertedBillingStatementId = quotation.convertedBillingStatementId;

  return (
    <>
      {embedded ? null : <Stack.Screen options={{ title }} />}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <RecordHeader
          title={title}
          chips={(
            <>
              <StatusChip label={draft ? 'Not numbered yet' : sentenceCase(quotation.documentState)} tone={documentStateTone(quotation.documentState)} />
              {expired ? <StatusChip label="Expired" tone="neutral" /> : null}
              {quotation.convertedKind ? <StatusChip label={`Converted to ${quotation.convertedKind === 'repair' ? 'repair' : 'delivery'}`} tone="accent" /> : null}
            </>
          )}
          subtitle={`${quotation.customerName} · ${formatDisplayDate(quotation.businessDate)} · valid until ${formatDisplayDate(quotation.validUntil)}`}
          actions={draft ? (
            <>
              <ActionButton compact disabled={busy} variant="danger" onPress={removeDraft}>Delete draft</ActionButton>
              <ActionButton compact disabled={busy} variant="secondary" onPress={previewDraft}>Preview PDF</ActionButton>
              <ActionButton compact disabled={busy || !quotation.lines.length} onPress={finalize}>Finalize quotation</ActionButton>
            </>
          ) : finalized ? (
            <>
              <ActionButton compact disabled={busy} variant="secondary" onPress={openPreview}>
                {quotation.hasSignedVersion ? 'Preview signed quotation' : 'Preview quotation'}
              </ActionButton>
              {quotation.pdfState === 'ready'
                ? <ActionButton compact disabled={busy} variant={finalized && !quotation.convertedKind ? 'secondary' : 'primary'} onPress={() => void run(async () => { await shareBundle(db, await getQuotationShareBundle(db, quotation.id)); })}>Share PDF</ActionButton>
                : <ActionButton compact disabled={busy} variant="secondary" onPress={() => void run(() => retryQuotationPdf(db, quotation.id))}>Retry PDF</ActionButton>}
              {finalized && !quotation.convertedKind ? (
                <ActionButton compact disabled={busy} onPress={() => router.push({ pathname: '/quotations/convert', params: { quotationId: quotation.id } })}>Convert to repair or delivery</ActionButton>
              ) : null}
              {finalized ? (
                <ActionMenu
                  actions={[
                    !quotation.hasSignedVersion && { label: 'Sign quotation', note: 'Capture or record signatures', onPress: () => goSigning('sign'), disabled: busy },
                    { label: 'Import signed PDF', note: "The customer's signed copy", onPress: () => goSigning('import'), disabled: busy },
                    !quotation.convertedKind && {
                      label: 'Void quotation',
                      note: 'Needs a reason',
                      destructive: true,
                      disabled: busy,
                      onPress: () => router.push({ pathname: '/quotations/void', params: { quotationId: quotation.id } }),
                    },
                  ]}
                />
              ) : null}
            </>
          ) : null}
        />

        {error ? <Text accessibilityLiveRegion="polite" selectable style={text.error}>{error}</Text> : null}
        {expired ? (
          <View style={styles.notice}>
            <Text style={text.body}>This quotation has expired. It can still be converted if the customer accepts it now.</Text>
          </View>
        ) : null}
        {quotation.documentState === 'voided' ? (
          <View style={[styles.notice, styles.voidNotice]}>
            <Text style={[text.body, styles.voidText]}>This quotation was voided. It stays on record and cannot be edited or converted.</Text>
          </View>
        ) : null}

        {draft ? (
          <View style={styles.draftFields}>
            <View style={styles.field}><DateField label="Quotation date" value={businessDate} onChange={setBusinessDate} /></View>
            <View style={styles.field}><DateField label="Valid until" value={validUntil} minDate={businessDate} allowFuture onChange={setValidUntil} /></View>
            <View style={styles.discountField}>
              <Text style={text.label}>Discount</Text>
              <View style={styles.segmented}>
                {DISCOUNT_CHOICES.map((choice, index) => {
                  const selected = discountType === choice.value;
                  return (
                    <Pressable
                      key={choice.label}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => { setDiscountType(choice.value); setDiscountValue(''); }}
                      style={[styles.segment, index > 0 ? styles.segmentDivider : null, selected ? styles.segmentSelected : null]}
                    >
                      <Text style={[styles.segmentText, selected ? styles.segmentTextSelected : null]}>{choice.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {discountType ? (
                <FormField keyboardType="decimal-pad" label={discountType === 'percentage' ? 'Discount percent' : 'Discount amount'} onChangeText={setDiscountValue} value={discountValue} />
              ) : null}
              <Text style={text.meta}>Changes here are saved when you add a line, preview or finalize.</Text>
            </View>
          </View>
        ) : (
          <View style={styles.facts}>
            {finalized ? <Fact label="Signature status">{sentenceCase(quotation.signatureStatus)}</Fact> : null}
            <Fact label="Converted into">
              {quotation.convertedKind ? (
                <View style={styles.links}>
                  {convertedServiceReportId ? <LinkText label="Open the CSR" onPress={() => router.push({ pathname: '/service-reports/[report-id]', params: { 'report-id': convertedServiceReportId } })} /> : null}
                  {convertedDeliveryId ? <LinkText label="Open the delivery form" onPress={() => router.push({ pathname: '/deliveries/[delivery-id]', params: { 'delivery-id': convertedDeliveryId } })} /> : null}
                  {convertedBillingStatementId ? <LinkText label="Open the Billing Statement" onPress={() => router.push({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': convertedBillingStatementId } })} /> : null}
                </View>
              ) : <Text style={text.body}>Not converted yet</Text>}
            </Fact>
          </View>
        )}

        <SectionTitle title="Items and services">
          {draft ? <ActionButton compact disabled={busy} variant="secondary" onPress={openAddLine}>Add</ActionButton> : null}
        </SectionTitle>
        {quotation.lines.length ? (
          <Panel>
            <View style={[styles.tableRow, styles.tableHead]}>
              <Text style={[text.label, styles.colMain]}>Description</Text>
              <Text style={[text.label, styles.colQty]}>Qty</Text>
              <Text style={[text.label, styles.colAmount]}>Unit price</Text>
              <Text style={[text.label, styles.colAmount]}>Amount</Text>
              {draft ? <View style={styles.colRemove} /> : null}
            </View>
            {quotation.lines.map((line) => (
              <View key={line.id} style={[styles.tableRow, styles.tableDivider]}>
                <View style={styles.colMain}>
                  <Text selectable style={text.body}>{line.description}</Text>
                  <Text style={text.meta}>
                    {sentenceCase(line.lineType)}{line.priceSource === 'override' ? ` · quoted price, reason: ${line.overrideReason}` : ''}
                  </Text>
                </View>
                <Text style={[text.body, styles.colQty]}>{line.quantity}</Text>
                <Text style={[text.amount, styles.colAmount, styles.unitPrice]}>{formatCentavos(line.unitPriceCentavos)}</Text>
                <Text style={[text.amount, styles.colAmount]}>{formatCentavos(line.amountCentavos)}</Text>
                {draft ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${line.description}`} hitSlop={8} onPress={() => void run(() => removeQuotationLine(db, quotation.id, line.id))} style={styles.colRemove}>
                    <Text style={styles.remove}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </Panel>
        ) : <Text style={text.meta}>No items or services yet. Use Add to price items and services for this customer.</Text>}

        <View style={styles.totals}>
          <View style={styles.totalLine}><Text style={text.meta}>Subtotal</Text><Text style={text.amount}>{formatCentavos(quotation.subtotalCentavos)}</Text></View>
          {discount > 0 ? <View style={styles.totalLine}><Text style={text.meta}>Discount</Text><Text style={text.amount}>− {formatCentavos(discount)}</Text></View> : null}
          <View style={[styles.totalLine, styles.grandLine]}>
            <Text style={text.bodyStrong}>Total</Text>
            <Text style={styles.grandValue}>{formatCentavos(quotation.totalCentavos)}</Text>
          </View>
        </View>
      </ScrollView>
    </>
  );
}

function LinkText({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} style={styles.link}>
      <Text style={styles.linkText}>{label} ›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  content: { gap: spacing.lg, padding: spacing.xxl, paddingBottom: 48 },
  notice: { padding: spacing.md, borderRadius: radius.control, backgroundColor: colors.neutralTint },
  voidNotice: { backgroundColor: colors.errorTint },
  voidText: { color: colors.error },
  draftFields: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  field: { flexBasis: 200, flexGrow: 1, maxWidth: 260 },
  discountField: { flexBasis: 320, flexGrow: 2, gap: 6 },
  segmented: { flexDirection: 'row', borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.control, overflow: 'hidden' },
  segment: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  segmentDivider: { borderLeftWidth: 1, borderLeftColor: colors.inputBorder },
  segmentSelected: { backgroundColor: colors.primary },
  segmentText: { color: colors.tertiaryLabel, fontSize: fontSize.meta, fontWeight: '600' },
  segmentTextSelected: { color: colors.onPrimary },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xl },
  links: { gap: 2 },
  link: { minHeight: 36, justifyContent: 'center' },
  linkText: { color: colors.primary, fontSize: fontSize.body, fontWeight: '600' },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  tableHead: { paddingVertical: 8, backgroundColor: colors.subtleSurface },
  tableDivider: { borderTopWidth: 1, borderTopColor: colors.hairline },
  colMain: { flex: 1, minWidth: 0 },
  colQty: { width: 50, textAlign: 'right' },
  colAmount: { width: 110, textAlign: 'right' },
  unitPrice: { fontWeight: '400' },
  colRemove: { width: 64, alignItems: 'flex-end' },
  remove: { color: colors.error, fontSize: fontSize.meta, fontWeight: '600', paddingVertical: 8 },
  totals: {
    alignSelf: 'flex-end',
    width: 320,
    maxWidth: '100%',
    gap: 6,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: radius.panel,
  },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  grandLine: { paddingTop: 8, marginTop: 2, borderTopWidth: 1, borderTopColor: colors.separator },
  grandValue: { color: colors.label, fontSize: fontSize.section, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
