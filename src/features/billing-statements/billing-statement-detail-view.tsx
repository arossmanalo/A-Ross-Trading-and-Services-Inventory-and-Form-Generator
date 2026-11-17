import { Stack, router, useFocusEffect } from 'expo-router';
import * as Print from 'expo-print';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { ActionMenu } from '@/components/action-menu';
import { DateField } from '@/components/date-field';
import { FormField } from '@/components/form-field';
import { Notice as HighlightNotice } from '@/components/notice';
import { Fact, Panel, RecordHeader, SectionTitle } from '@/components/record-layout';
import { StatusChip, documentStateTone, sentenceCase, type ChipTone } from '@/components/status-chip';
import { formatDisplayDate } from '@/domain/calendar';
import { formatCentavos, parseCurrencyToCentavos } from '@/domain/money';
import { retryBillingStatementPdf } from '@/features/billing-statements/billing-statement-pdf';
import { deleteBillingStatementDraft, getBillingStatement, removeBillingLine, removeNonbillableExpense, updateBillingStatementDraft } from '@/features/billing-statements/billing-statement-repository';
import type { BillingDiscountType, BillingStatementDetail } from '@/features/billing-statements/billing-statement-types';
import { getBillingStatementShareBundle, shareBundle } from '@/features/documents/share-bundle';
import { listPaymentsForStatement } from '@/features/payments/payment-repository';
import type { StatementPaymentStatus } from '@/features/payments/payment-types';
import { getSignedPreviewTarget } from '@/features/signatures/signed-preview';
import { colors } from '@/theme/colors';
import { fontSize, radius, spacing, text } from '@/theme/typography';

const DISCOUNT_CHOICES: Array<{ value: BillingDiscountType; label: string }> = [
  { value: null, label: 'None' },
  { value: 'fixed', label: 'Fixed amount' },
  { value: 'percentage', label: 'Percentage' },
];

const PAYMENT_STATUS: Record<StatementPaymentStatus['status'], { label: string; tone: ChipTone }> = {
  paid: { label: 'Paid', tone: 'final' },
  balance_due: { label: 'Balance due', tone: 'draft' },
  unpaid: { label: 'Unpaid', tone: 'void' },
};

type BillingStatementDetailViewProps = {
  statementId: string;
  embedded?: boolean;
  onDeleted?: () => void;
};

export function BillingStatementDetailView({ statementId, embedded = false, onDeleted }: BillingStatementDetailViewProps) {
  const db = useSQLiteContext();
  const [statement, setStatement] = useState<BillingStatementDetail | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<StatementPaymentStatus | null>(null);
  const [businessDate, setBusinessDate] = useState('');
  const [discountType, setDiscountType] = useState<BillingDiscountType>(null);
  const [discountValue, setDiscountValue] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);

  const load = useCallback(async () => {
    try {
      const row = await getBillingStatement(db, statementId);
      setStatement(row);
      setPaymentStatus(row?.documentState === 'finalized' ? await listPaymentsForStatement(db, statementId) : null);
      if (row?.documentState === 'draft') {
        setBusinessDate(row.businessDate);
        setDiscountType(row.discountType);
        setDiscountValue(row.discountType === 'percentage' ? String(row.discountValue / 100) : row.discountType === 'fixed' ? String(row.discountValue / 100) : '');
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load statement.');
    } finally {
      setLoaded(true);
    }
  }, [db, statementId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await action(); await load(); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : 'The action failed.'); }
    finally { setBusy(false); }
  }, [load]);

  const saveDraftValues = useCallback(async () => {
    const value = discountType === 'percentage' ? Math.round(Number(discountValue || '0') * 100) : discountType === 'fixed' ? parseCurrencyToCentavos(discountValue || '0') : 0;
    await updateBillingStatementDraft(db, statementId, { businessDate, discountType, discountValue: value });
  }, [businessDate, db, discountType, discountValue, statementId]);

  const save = useCallback(() => run(saveDraftValues), [run, saveDraftValues]);

  // Once signed, the preview shows the signed version instead of the plain PDF.
  const openPreview = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const target = statement?.hasSignedVersion ? await getSignedPreviewTarget(db, 'billing_statement', statementId) : null;
      if (target?.kind === 'capture') {
        router.push({ pathname: '/signatures/preview', params: { captureId: target.captureId, kind: 'billing_statement', ownerId: statementId } });
      } else if (target?.kind === 'attachment') {
        await Print.printAsync({ uri: target.uri });
      } else {
        router.push({ pathname: '/billing-statements/preview', params: { statementId } });
      }
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Could not open the preview.');
    } finally {
      setBusy(false);
    }
  }, [db, statement?.hasSignedVersion, statementId]);

  const previewDraft = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await saveDraftValues();
      router.push({ pathname: '/billing-statements/preview', params: { statementId } });
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Could not save the statement before previewing.');
    } finally {
      setBusy(false);
    }
  }, [saveDraftValues, statementId]);

  const removeLine = useCallback((id: string) => Alert.alert('Remove charge?', 'This only changes the draft.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => void run(() => removeBillingLine(db, statementId, id)) },
  ]), [db, run, statementId]);

  const removeExpense = useCallback((id: string) => Alert.alert('Remove expense?', 'This removes the non-chargeable cost record from this draft.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => void run(() => removeNonbillableExpense(db, statementId, id)) },
  ]), [db, run, statementId]);

  const removeDraft = useCallback(() => Alert.alert('Delete draft?', 'The unnumbered draft and its expenses will be permanently removed.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: () => void (async () => {
        try {
          await deleteBillingStatementDraft(db, statementId);
          if (onDeleted) onDeleted();
          else router.back();
        } catch (deleteError) {
          setError(deleteError instanceof Error ? deleteError.message : 'Could not delete draft.');
        }
      })(),
    },
  ]), [db, onDeleted, statementId]);

  if (!loaded) return <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>;
  if (!statement) return <View style={styles.centered}><Text selectable style={text.error}>{error ?? 'Billing Statement was not found.'}</Text></View>;

  const draft = statement.documentState === 'draft';
  const finalized = statement.documentState === 'finalized';
  const linkedCsrIsDraft = Boolean(statement.serviceReportId && !statement.serviceReportNumber);
  const discount = statement.subtotalCentavos - statement.discountedTotalCentavos;
  const nonBillableExpenses = statement.expenses.filter((expense) => !expense.billable);
  const twoColumns = width >= 900;
  const title = statement.bsNumber ?? 'Statement draft';
  const serviceReportId = statement.serviceReportId;
  const deliveryId = statement.deliveryId;
  const goSigning = (mode: 'sign' | 'import') => router.push({ pathname: '/signatures/manage', params: { ownerType: 'billing_statement', ownerId: statementId, mode } });

  const totals = (
    <View style={styles.totals}>
      <View style={styles.totalLine}><Text style={text.meta}>Subtotal</Text><Text style={text.amount}>{formatCentavos(statement.subtotalCentavos)}</Text></View>
      {discount > 0 ? <View style={styles.totalLine}><Text style={text.meta}>Discount</Text><Text style={text.amount}>− {formatCentavos(discount)}</Text></View> : null}
      {paymentStatus ? <View style={styles.totalLine}><Text style={text.meta}>Payments received</Text><Text style={text.amount}>− {formatCentavos(paymentStatus.activePaidCentavos)}</Text></View> : null}
      <View style={[styles.totalLine, styles.grandLine]}>
        <Text style={text.bodyStrong}>{paymentStatus ? 'Balance due' : 'Total'}</Text>
        <Text style={styles.grandValue}>{formatCentavos(paymentStatus?.balanceCentavos ?? statement.discountedTotalCentavos)}</Text>
      </View>
      {nonBillableExpenses.length ? (
        <View style={styles.totalLine}>
          <Text style={text.meta}>Expenses, not charged</Text>
          <Text style={[text.meta, styles.tabular]}>{formatCentavos(nonBillableExpenses.reduce((sum, expense) => sum + expense.actualCostCentavos, 0))}</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <>
      {embedded ? null : <Stack.Screen options={{ title }} />}
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        <RecordHeader
          title={title}
          chips={(
            <>
              <StatusChip label={draft ? 'Not numbered yet' : sentenceCase(statement.documentState)} tone={documentStateTone(statement.documentState)} />
              {paymentStatus ? <StatusChip label={PAYMENT_STATUS[paymentStatus.status].label} tone={PAYMENT_STATUS[paymentStatus.status].tone} /> : null}
            </>
          )}
          subtitle={`${statement.customerName} · ${formatDisplayDate(statement.businessDate)} · Not a Tax Invoice`}
          actions={draft ? (
            <>
              <ActionButton compact disabled={busy} variant="danger" onPress={removeDraft}>Delete draft</ActionButton>
              <ActionButton compact disabled={busy} variant="secondary" onPress={() => void previewDraft()}>Preview PDF</ActionButton>
              <ActionButton compact disabled={busy || !statement.lines.length} onPress={() => router.push({ pathname: '/billing-statements/finalize', params: { statementId } })}>
                Choose payment and finalize
              </ActionButton>
            </>
          ) : finalized ? (
            <>
              <ActionButton compact disabled={busy} variant="secondary" onPress={() => void openPreview()}>
                {statement.hasSignedVersion ? 'Preview signed statement' : 'Preview statement'}
              </ActionButton>
              <ActionButton
                compact
                disabled={busy}
                variant={paymentStatus && paymentStatus.balanceCentavos > 0 ? 'secondary' : 'primary'}
                onPress={() => void run(async () => { await shareBundle(db, await getBillingStatementShareBundle(db, statementId)); })}
              >
                Share PDF
              </ActionButton>
              {paymentStatus && paymentStatus.balanceCentavos > 0 ? (
                <ActionButton compact onPress={() => router.push({ pathname: '/payments/new', params: { statementId } })}>Record payment</ActionButton>
              ) : null}
              <ActionMenu
                actions={[
                  !statement.hasSignedVersion && { label: 'Sign Billing Statement', note: 'Capture or record signatures', onPress: () => goSigning('sign'), disabled: busy },
                  { label: 'Import signed PDF', note: "The customer's signed copy", onPress: () => goSigning('import'), disabled: busy },
                  statement.pdfState === 'error' && { label: 'Retry statement PDF', onPress: () => void run(() => retryBillingStatementPdf(db, statementId)), disabled: busy },
                  paymentStatus?.activePaidCentavos === 0 && {
                    label: 'Void unpaid statement',
                    note: 'Needs a reason',
                    destructive: true,
                    disabled: busy,
                    onPress: () => router.push({ pathname: '/billing-statements/void', params: { statementId } }),
                  },
                ]}
              />
            </>
          ) : null}
        />

        {error ? <Text accessibilityLiveRegion="polite" selectable style={text.error}>{error}</Text> : null}
        {statement.documentState === 'voided' ? (
          <View style={styles.voidNotice}><Text style={[text.body, styles.voidText]}>This statement is void. Its number remains permanently used.</Text></View>
        ) : null}

        <View style={[styles.columns, twoColumns ? styles.columnsWide : null]}>
          <View style={[styles.column, twoColumns ? styles.mainColumn : null]}>
            <View style={styles.facts}>
              <Fact label={statement.deliveryId ? 'Linked delivery' : 'Linked CSR'}>
                {serviceReportId ? (
                  <LinkText label={statement.serviceReportNumber ?? 'Draft CSR, not numbered yet'} onPress={() => router.push({ pathname: '/service-reports/[report-id]', params: { 'report-id': serviceReportId } })} />
                ) : deliveryId ? (
                  <LinkText label={statement.deliveryNumber ?? 'Draft delivery, not numbered yet'} onPress={() => router.push({ pathname: '/deliveries/[delivery-id]', params: { 'delivery-id': deliveryId } })} />
                ) : <Text style={text.body}>None</Text>}
              </Fact>
              {!draft ? <Fact label="Signature status">{sentenceCase(statement.signatureStatus)}</Fact> : null}
            </View>

            {serviceReportId ? (
              // Highlighted like the box on the CSR, so staff can find the way back to the source document.
              <HighlightNotice label="Linked CSR">
                <Text style={text.body}>
                  {draft && linkedCsrIsDraft
                    ? 'Items and services added here are saved on the linked CSR too. Existing CSR charges appear automatically; do not add them twice. Edit or remove shared charges on the CSR, then finalize the CSR before this statement.'
                    : `This statement bills the visit on ${statement.serviceReportNumber ?? 'the linked CSR draft'}.`}
                </Text>
                <ActionButton
                  disabled={busy}
                  style={styles.linkedButton}
                  onPress={() => router.push({ pathname: '/service-reports/[report-id]', params: { 'report-id': serviceReportId } })}
                >
                  {draft && linkedCsrIsDraft ? 'Continue linked CSR draft' : `Open ${statement.serviceReportNumber ?? 'linked CSR'}`}
                </ActionButton>
              </HighlightNotice>
            ) : null}
            {deliveryId ? (
              <HighlightNotice label="Linked delivery">
                <Text style={text.body}>
                  {draft
                    ? `Delivered items are billed exactly as delivered and were already taken from stock by the delivery. Change them on the delivery${statement.deliveryNumber ? '' : ', then finalize the delivery before this statement'}. Services and other charges can still be added here.`
                    : `This statement bills the items on ${statement.deliveryNumber ?? 'the linked delivery draft'}.`}
                </Text>
                <ActionButton
                  disabled={busy}
                  style={styles.linkedButton}
                  onPress={() => router.push({ pathname: '/deliveries/[delivery-id]', params: { 'delivery-id': deliveryId } })}
                >
                  {statement.deliveryNumber ? `Open ${statement.deliveryNumber}` : 'Open the linked delivery'}
                </ActionButton>
              </HighlightNotice>
            ) : null}
            {draft && linkedCsrIsDraft && statement.lines.length === 0 ? (
              <Notice>
                <Text style={text.body}>No eligible billable CSR charges are available yet. Non-billable item usage is excluded, and a CSR source charge cannot be billed on more than one statement.</Text>
              </Notice>
            ) : null}

            {draft ? (
              <View style={styles.draftFields}>
                <View style={styles.dateField}><DateField label="Business date" value={businessDate} onChange={setBusinessDate} /></View>
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
                    <FormField label={discountType === 'fixed' ? 'Discount amount' : 'Discount percent'} value={discountValue} onChangeText={setDiscountValue} keyboardType="decimal-pad" placeholder="0" />
                  ) : null}
                </View>
                <ActionButton compact disabled={busy} variant="secondary" style={styles.saveButton} onPress={() => void save()}>{busy ? 'Saving…' : 'Save details'}</ActionButton>
              </View>
            ) : null}

            <SectionTitle title="Charges">
              {draft ? <ActionButton compact variant="secondary" onPress={() => router.push({ pathname: '/billing-statements/charge/new', params: { statementId } })}>Add charge</ActionButton> : null}
            </SectionTitle>
            {statement.lines.length ? (
              <Panel>
                {statement.lines.map((line, index) => {
                  const fromCsr = Boolean(line.sourceCsrUsageId || line.sourceCsrServiceUsageId || line.sourceCsrMachineServiceId);
                  const removable = draft && !(linkedCsrIsDraft && fromCsr);
                  return (
                    <View key={line.id} style={[styles.lineRow, index > 0 ? styles.lineDivider : null]}>
                      <View style={styles.lineCopy}>
                        <Text selectable style={text.body}>{line.description}</Text>
                        <Text style={text.meta}>
                          {sentenceCase(line.lineType)} · {line.quantity} × {formatCentavos(line.unitPriceCentavos)}{fromCsr ? ' · from linked CSR' : ''}
                        </Text>
                        {line.controlNumber ? <Text selectable style={text.meta}>Control No. {line.controlNumber}</Text> : null}
                        {line.overrideReason ? <Text style={styles.override}>Price changed: {line.overrideReason}</Text> : null}
                      </View>
                      <Text style={[text.amount, styles.lineAmount]}>{formatCentavos(line.amountCentavos)}</Text>
                      {removable ? (
                        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${line.description}`} hitSlop={8} onPress={() => removeLine(line.id)}>
                          <Text style={styles.remove}>Remove</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </Panel>
            ) : <Text style={text.meta}>No billable charges yet.</Text>}

            {nonBillableExpenses.length ? (
              <>
                <SectionTitle title="Non-chargeable expenses" />
                <Text style={text.meta}>Kept for profit reports. Not added to what the customer pays.</Text>
                <Panel>
                  {nonBillableExpenses.map((expense, index) => (
                    <View key={expense.id} style={[styles.lineRow, index > 0 ? styles.lineDivider : null]}>
                      <View style={styles.lineCopy}>
                        <Text selectable style={text.body}>{expense.description}</Text>
                        <Text style={text.meta}>Actual cost</Text>
                      </View>
                      <Text style={[text.amount, styles.lineAmount]}>{formatCentavos(expense.actualCostCentavos)}</Text>
                      {draft ? (
                        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${expense.description}`} hitSlop={8} onPress={() => removeExpense(expense.id)}>
                          <Text style={styles.remove}>Remove</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </Panel>
              </>
            ) : null}

            {paymentStatus ? (
              <>
                <SectionTitle title="Payments">
                  <StatusChip label={PAYMENT_STATUS[paymentStatus.status].label} tone={PAYMENT_STATUS[paymentStatus.status].tone} />
                </SectionTitle>
                {paymentStatus.payments.length ? (
                  <Panel>
                    {paymentStatus.payments.map((payment, index) => (
                      <Pressable
                        key={payment.id}
                        accessibilityRole="link"
                        onPress={() => router.push({ pathname: '/payments/[payment-id]', params: { 'payment-id': payment.id } })}
                        style={({ pressed }) => [styles.lineRow, index > 0 ? styles.lineDivider : null, pressed ? styles.pressed : null]}
                      >
                        <View style={styles.lineCopy}>
                          <Text style={text.bodyStrong}>{payment.paNumber} · {formatDisplayDate(payment.businessDate)}</Text>
                          <Text style={text.meta}>{sentenceCase(payment.method)} · {sentenceCase(payment.state)}</Text>
                        </View>
                        <Text style={[text.amount, styles.lineAmount, payment.state === 'voided' ? styles.voidAmount : null]}>{formatCentavos(payment.amountCentavos)}</Text>
                        <Text style={styles.chevron}>›</Text>
                      </Pressable>
                    ))}
                  </Panel>
                ) : <Text style={text.meta}>No payment has been recorded.</Text>}
              </>
            ) : null}

            {finalized ? (
              <View style={styles.footnotes}>
                {statement.serviceReportNumber ? <Text style={text.meta}>{statement.serviceReportNumber} is sent in the same PDF, as the first page(s), followed by this statement.</Text> : null}
                {statement.deliveryNumber ? <Text style={text.meta}>{statement.deliveryNumber} is sent in the same PDF, as the first page, followed by this statement.</Text> : null}
                {paymentStatus && paymentStatus.activePaidCentavos > 0 ? <Text style={text.meta}>Void its active payment records before voiding this statement.</Text> : null}
              </View>
            ) : null}
          </View>

          <View style={[styles.column, twoColumns ? styles.sideColumn : null]}>{totals}</View>
        </View>
      </ScrollView>
    </>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <View style={styles.notice}>{children}</View>;
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
  voidNotice: { padding: spacing.md, borderRadius: radius.control, backgroundColor: colors.errorTint },
  voidText: { color: colors.error },
  columns: { gap: spacing.xxl },
  columnsWide: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { gap: spacing.md },
  mainColumn: { flex: 1, minWidth: 0 },
  sideColumn: { width: 300 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xl },
  link: { minHeight: 32, justifyContent: 'center' },
  linkText: { color: colors.primary, fontSize: fontSize.body, fontWeight: '600' },
  notice: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.control, backgroundColor: colors.neutralTint },
  linkedButton: { alignSelf: 'flex-start', marginTop: spacing.sm },
  draftFields: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: spacing.lg },
  dateField: { flexBasis: 200, flexGrow: 1, maxWidth: 260 },
  discountField: { flexBasis: 300, flexGrow: 2, gap: 6 },
  saveButton: { alignSelf: 'flex-end' },
  segmented: { flexDirection: 'row', borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.control, overflow: 'hidden' },
  segment: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  segmentDivider: { borderLeftWidth: 1, borderLeftColor: colors.inputBorder },
  segmentSelected: { backgroundColor: colors.primary },
  segmentText: { color: colors.tertiaryLabel, fontSize: fontSize.meta, fontWeight: '600' },
  segmentTextSelected: { color: colors.onPrimary },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  lineDivider: { borderTopWidth: 1, borderTopColor: colors.hairline },
  lineCopy: { flex: 1, minWidth: 0, gap: 2 },
  lineAmount: { width: 110, textAlign: 'right' },
  override: { color: colors.warning, fontSize: fontSize.meta },
  remove: { color: colors.error, fontSize: fontSize.meta, fontWeight: '600', paddingVertical: 10 },
  voidAmount: { color: colors.secondaryLabel, textDecorationLine: 'line-through' },
  chevron: { color: colors.secondaryLabel, fontSize: fontSize.section },
  pressed: { backgroundColor: colors.subtleSurface },
  footnotes: { gap: 4 },
  totals: {
    gap: 6,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: radius.panel,
  },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.md },
  grandLine: { paddingTop: 8, marginTop: 2, borderTopWidth: 1, borderTopColor: colors.separator },
  grandValue: { color: colors.label, fontSize: fontSize.section, fontWeight: '600', fontVariant: ['tabular-nums'] },
  tabular: { fontVariant: ['tabular-nums'] },
});
