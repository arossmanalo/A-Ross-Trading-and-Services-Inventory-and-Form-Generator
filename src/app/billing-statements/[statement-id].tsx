import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { getLocalBusinessDate } from '@/domain/business-date';
import { formatCentavos, parseCurrencyToCentavos } from '@/domain/money';
import { retryBillingStatementPdf, shareBillingStatementPdf } from '@/features/billing-statements/billing-statement-pdf';
import { deleteBillingStatementDraft, getBillingStatement, removeBillingLine, removeNonbillableExpense, updateBillingStatementDraft } from '@/features/billing-statements/billing-statement-repository';
import type { BillingDiscountType, BillingStatementDetail } from '@/features/billing-statements/billing-statement-types';
import { listPaymentsForStatement } from '@/features/payments/payment-repository';
import type { StatementPaymentStatus } from '@/features/payments/payment-types';
import { colors } from '@/theme/colors';

export default function BillingStatementDetailScreen() {
  const { 'statement-id': statementId } = useLocalSearchParams<{ 'statement-id': string }>();
  const db = useSQLiteContext();
  const [statement, setStatement] = useState<BillingStatementDetail | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<StatementPaymentStatus | null>(null);
  const [businessDate, setBusinessDate] = useState('');
  const [backdateReason, setBackdateReason] = useState('');
  const [discountType, setDiscountType] = useState<BillingDiscountType>(null);
  const [discountValue, setDiscountValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!statementId) return;
    try {
      const row = await getBillingStatement(db, statementId);
      setStatement(row);
      setPaymentStatus(row?.documentState === 'finalized' ? await listPaymentsForStatement(db, statementId) : null);
      if (row?.documentState === 'draft') {
        setBusinessDate(row.businessDate);
        setBackdateReason(row.backdateReason ?? '');
        setDiscountType(row.discountType);
        setDiscountValue(row.discountType === 'percentage' ? String(row.discountValue / 100) : row.discountType === 'fixed' ? String(row.discountValue / 100) : '');
      }
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Could not load statement.'); }
  }, [db, statementId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await action(); await load(); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : 'The action failed.'); }
    finally { setBusy(false); }
  }, [load]);

  const save = useCallback(() => run(async () => {
    const value = discountType === 'percentage' ? Math.round(Number(discountValue || '0') * 100) : discountType === 'fixed' ? parseCurrencyToCentavos(discountValue || '0') : 0;
    await updateBillingStatementDraft(db, statementId, { businessDate, backdateReason, discountType, discountValue: value });
  }), [backdateReason, businessDate, db, discountType, discountValue, run, statementId]);

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
    { text: 'Delete', style: 'destructive', onPress: () => void (async () => { try { await deleteBillingStatementDraft(db, statementId); router.back(); } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : 'Could not delete draft.'); } })() },
  ]), [db, statementId]);

  if (!statement) return <View style={styles.center}><Text selectable style={styles.help}>{error ?? 'Loading statement…'}</Text></View>;
  const draft = statement.documentState === 'draft';
  const discount = statement.subtotalCentavos - statement.discountedTotalCentavos;

  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
    <View style={styles.hero}><View><Text selectable style={styles.eyebrow}>{statement.documentState.toUpperCase()}</Text><Text selectable style={styles.number}>{statement.bsNumber ?? 'Unnumbered draft'}</Text></View><Text selectable style={styles.total}>{formatCentavos(statement.discountedTotalCentavos)}</Text></View>
    <View style={styles.card}><Label label="Customer" value={statement.customerName} /><Label label="Linked CSR" value={statement.serviceReportNumber ?? 'None'} /><Label label="Date" value={statement.businessDate} /></View>
    {draft ? <View style={styles.card}><Text selectable style={styles.sectionTitle}>Draft details</Text><FormField label="Business date" value={businessDate} onChangeText={setBusinessDate} placeholder="YYYY-MM-DD" />{businessDate < getLocalBusinessDate() ? <FormField label="Backdate reason" value={backdateReason} onChangeText={setBackdateReason} /> : null}<Text selectable style={styles.fieldLabel}>Discount</Text><View style={styles.pills}>{([null, 'fixed', 'percentage'] as BillingDiscountType[]).map((value) => <Pressable key={value ?? 'none'} accessibilityRole="button" onPress={() => { setDiscountType(value); setDiscountValue(''); }} style={[styles.pill, discountType === value && styles.activePill]}><Text selectable style={[styles.pillText, discountType === value && styles.activePillText]}>{value === null ? 'None' : value === 'fixed' ? 'Fixed amount' : 'Percentage'}</Text></Pressable>)}</View>{discountType ? <FormField label={discountType === 'fixed' ? 'Discount amount' : 'Discount percent'} value={discountValue} onChangeText={setDiscountValue} keyboardType="decimal-pad" placeholder="0" /> : null}<ActionButton disabled={busy} variant="secondary" onPress={() => void save()}>{busy ? 'Saving…' : 'Save details'}</ActionButton></View> : null}
    <View style={styles.section}><View style={styles.sectionHeader}><Text selectable style={styles.sectionTitle}>Charges</Text>{draft ? <ActionButton compact onPress={() => router.push({ pathname: '/billing-statements/charge/new', params: { statementId } })}>Add charge</ActionButton> : null}</View>{statement.lines.length ? statement.lines.map((line) => <View key={line.id} style={styles.line}><View style={styles.lineCopy}><Text selectable style={styles.lineTitle}>{line.description}</Text><Text selectable style={styles.help}>{line.lineType.toUpperCase()} · {line.quantity} × {formatCentavos(line.unitPriceCentavos)}{line.sourceCsrUsageId ? ' · from linked CSR' : ''}</Text>{line.overrideReason ? <Text selectable style={styles.override}>Override: {line.overrideReason}</Text> : null}</View><Text selectable style={styles.lineAmount}>{formatCentavos(line.amountCentavos)}</Text>{draft ? <Pressable accessibilityRole="button" onPress={() => removeLine(line.id)}><Text selectable style={styles.remove}>REMOVE</Text></Pressable> : null}</View>) : <Text selectable style={styles.help}>No billable charges yet.</Text>}</View>
    {statement.expenses.some((expense) => !expense.billable) ? <View style={styles.section}><Text selectable style={styles.sectionTitle}>Non-chargeable expenses</Text>{statement.expenses.filter((expense) => !expense.billable).map((expense) => <View key={expense.id} style={styles.line}><View style={styles.lineCopy}><Text selectable style={styles.lineTitle}>{expense.description}</Text><Text selectable style={styles.help}>Actual cost · {formatCentavos(expense.actualCostCentavos)}</Text></View>{draft ? <Pressable accessibilityRole="button" onPress={() => removeExpense(expense.id)}><Text selectable style={styles.remove}>REMOVE</Text></Pressable> : null}</View>)}</View> : null}
    <View style={styles.totals}><Label label="Subtotal" value={formatCentavos(statement.subtotalCentavos)} />{discount > 0 ? <Label label="Discount" value={`− ${formatCentavos(discount)}`} /> : null}{paymentStatus ? <Label label="Payments received" value={`− ${formatCentavos(paymentStatus.activePaidCentavos)}`} /> : null}<View style={styles.grand}><Text selectable style={styles.grandLabel}>{paymentStatus ? 'BALANCE DUE' : 'TOTAL'}</Text><Text selectable style={styles.grandValue}>{formatCentavos(paymentStatus?.balanceCentavos ?? statement.discountedTotalCentavos)}</Text></View></View>
    {paymentStatus ? <View style={styles.section}><View style={styles.sectionHeader}><View><Text selectable style={styles.sectionTitle}>Payments</Text><Text selectable style={statusStyle(paymentStatus.status)}>{statusLabel(paymentStatus.status)}</Text></View>{paymentStatus.balanceCentavos > 0 ? <ActionButton compact onPress={() => router.push({ pathname: '/payments/new', params: { statementId } })}>Record payment</ActionButton> : null}</View>{paymentStatus.payments.length ? paymentStatus.payments.map((payment) => <Pressable key={payment.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/payments/[payment-id]', params: { 'payment-id': payment.id } })} style={({ pressed }) => [styles.line, pressed && styles.pressed]}><View style={styles.lineCopy}><Text selectable style={styles.lineTitle}>{payment.paNumber} · {payment.businessDate}</Text><Text selectable style={styles.help}>{formatMethod(payment.method)} · {payment.state.toUpperCase()}</Text></View><Text selectable style={[styles.lineAmount, payment.state === 'voided' && styles.voidAmount]}>{formatCentavos(payment.amountCentavos)}</Text><Text selectable style={styles.chevron}>›</Text></Pressable>) : <Text selectable style={styles.help}>No payment has been recorded.</Text>}</View> : null}
    {error ? <Text selectable style={styles.error}>{error}</Text> : null}
    {draft ? <View style={styles.actions}><ActionButton disabled={busy || !statement.lines.length} onPress={() => router.push({ pathname: '/billing-statements/finalize', params: { statementId } })}>Choose payment and finalize</ActionButton><ActionButton disabled={busy} variant="danger" onPress={removeDraft}>Delete draft</ActionButton></View> : statement.documentState === 'finalized' ? <View style={styles.actions}><ActionButton disabled={busy} onPress={() => void run(() => shareBillingStatementPdf(db, statementId))}>Share Billing Statement PDF</ActionButton>{statement.pdfState === 'error' ? <ActionButton disabled={busy} variant="secondary" onPress={() => void run(() => retryBillingStatementPdf(db, statementId))}>Retry statement PDF</ActionButton> : null}{paymentStatus?.activePaidCentavos === 0 ? <ActionButton disabled={busy} variant="danger" onPress={() => router.push({ pathname: '/billing-statements/void', params: { statementId } })}>Void unpaid statement</ActionButton> : <Text selectable style={styles.help}>Void its active payment records before voiding this statement.</Text>}</View> : <View style={styles.voidNotice}><Text selectable style={styles.voidText}>This statement is void. Its number remains permanently used.</Text></View>}
  </ScrollView>;
}

function Label({ label, value }: { label: string; value: string }) { return <View style={styles.labelRow}><Text selectable style={styles.label}>{label}</Text><Text selectable style={styles.value}>{value}</Text></View>; }
function statusLabel(value: StatementPaymentStatus['status']) { return value === 'paid' ? 'PAID' : value === 'balance_due' ? 'BALANCE DUE' : 'UNPAID'; }
function statusStyle(value: StatementPaymentStatus['status']) { return value === 'paid' ? styles.paid : value === 'balance_due' ? styles.balance : styles.unpaid; }
function formatMethod(value: string) { return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()); }

const styles = StyleSheet.create({
  content: { gap: 16, padding: 18, paddingBottom: 44 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }, hero: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 18, backgroundColor: colors.brandNavy, borderRadius: 20, borderCurve: 'continuous' }, eyebrow: { color: '#a9c9f5', fontSize: 10, fontWeight: '900', letterSpacing: 1 }, number: { color: '#fff', fontSize: 21, fontWeight: '900', marginTop: 5 }, total: { color: '#fff', fontSize: 18, fontWeight: '900' },
  card: { gap: 12, padding: 16, backgroundColor: colors.surface, borderRadius: 16, borderCurve: 'continuous' }, labelRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 15 }, label: { color: colors.secondaryLabel, fontSize: 13, fontWeight: '700' }, value: { flex: 1, color: colors.label, fontSize: 13, fontWeight: '800', textAlign: 'right' }, section: { gap: 8 }, sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, sectionTitle: { color: colors.label, fontSize: 17, fontWeight: '900' }, fieldLabel: { color: colors.label, fontSize: 14, fontWeight: '700' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, pill: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: colors.separator, borderRadius: 20, backgroundColor: colors.surface }, activePill: { borderColor: colors.brandBlue, backgroundColor: '#eaf2ff' }, pillText: { color: colors.secondaryLabel, fontSize: 12, fontWeight: '800' }, activePillText: { color: colors.brandNavy }, line: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator }, lineCopy: { flex: 1, gap: 3 }, lineTitle: { color: colors.label, fontSize: 14, fontWeight: '800' }, lineAmount: { color: colors.label, fontSize: 13, fontWeight: '900' }, voidAmount: { color: colors.secondaryLabel, textDecorationLine: 'line-through' },
  help: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 17 }, override: { color: colors.warning, fontSize: 11 }, remove: { color: colors.error, fontSize: 8, fontWeight: '900' }, totals: { gap: 8, padding: 16, borderWidth: 1, borderColor: colors.separator, borderRadius: 16, borderCurve: 'continuous' }, grand: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, borderTopWidth: 2, borderTopColor: colors.brandNavy }, grandLabel: { color: colors.brandNavy, fontSize: 14, fontWeight: '900' }, grandValue: { color: colors.brandNavy, fontSize: 16, fontWeight: '900' }, paid: { color: colors.success, fontSize: 10, fontWeight: '900', letterSpacing: .7 }, balance: { color: colors.warning, fontSize: 10, fontWeight: '900', letterSpacing: .7 }, unpaid: { color: colors.error, fontSize: 10, fontWeight: '900', letterSpacing: .7 }, chevron: { color: colors.secondaryLabel, fontSize: 24 }, pressed: { opacity: .72 }, actions: { gap: 10 }, error: { color: colors.error, fontSize: 13, fontWeight: '600' }, voidNotice: { padding: 15, backgroundColor: '#fee2e2', borderRadius: 14 }, voidText: { color: colors.error, fontSize: 13, fontWeight: '800' },
});
