import { Stack, router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { RecordHeader } from '@/components/record-layout';
import { StatusChip, sentenceCase } from '@/components/status-chip';
import { formatDisplayDate } from '@/domain/calendar';
import { formatCentavos } from '@/domain/money';
import { retryPaymentPdf, sharePaymentPdf } from '@/features/payments/payment-pdf';
import { getPayment } from '@/features/payments/payment-repository';
import type { PaymentSummary } from '@/features/payments/payment-types';
import { colors } from '@/theme/colors';
import { fontSize, radius, spacing, text } from '@/theme/typography';

type PaymentDetailViewProps = { paymentId: string; embedded?: boolean };

export function PaymentDetailView({ paymentId, embedded = false }: PaymentDetailViewProps) {
  const db = useSQLiteContext();
  const [payment, setPayment] = useState<PaymentSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPayment(await getPayment(db, paymentId));
    setLoaded(true);
  }, [db, paymentId]);

  useFocusEffect(useCallback(() => {
    void load().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : 'Could not load payment.');
      setLoaded(true);
    });
  }, [load]));

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await action(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed.'); }
    finally { setBusy(false); }
  }, [load]);

  if (!loaded) return <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>;
  if (!payment) return <View style={styles.centered}><Text selectable style={text.error}>{error ?? 'Payment was not found.'}</Text></View>;

  const serviceReportId = payment.serviceReportId;
  const facts: Array<[string, string]> = [
    ['Customer', payment.customerName],
    ['Billing Statement', payment.billingStatementNumber],
    ...(serviceReportId ? [['Service report (CSR)', payment.serviceReportNumber ?? 'Draft CSR'] as [string, string]] : []),
    ['Payment type', sentenceCase(payment.paymentKind)],
    ['Method', sentenceCase(payment.method)],
    ['Reference', payment.referenceNumber ?? 'Not applicable'],
    ['Note', payment.note || '—'],
    ['PDF', sentenceCase(payment.pdfState)],
  ];

  return (
    <>
      {embedded ? null : <Stack.Screen options={{ title: payment.paNumber }} />}
      <ScrollView contentContainerStyle={styles.content}>
        <RecordHeader
          title={payment.paNumber}
          chips={<StatusChip label={payment.state === 'active' ? 'Active' : 'Void'} tone={payment.state === 'active' ? 'final' : 'void'} />}
          subtitle="Payment Acknowledgment · Not a Tax Receipt"
          actions={(
            <>
              {payment.state === 'active' ? (
                <ActionButton compact disabled={busy} variant="danger" onPress={() => router.push({ pathname: '/payments/void', params: { paymentId } })}>Void payment</ActionButton>
              ) : null}
              {payment.pdfState === 'ready'
                ? <ActionButton compact disabled={busy} onPress={() => void run(() => sharePaymentPdf(db, paymentId))}>Share acknowledgment</ActionButton>
                : <ActionButton compact disabled={busy} onPress={() => void run(() => retryPaymentPdf(db, paymentId))}>{busy ? 'Generating…' : 'Generate / retry acknowledgment PDF'}</ActionButton>}
            </>
          )}
        />
        {error ? <Text accessibilityLiveRegion="polite" selectable style={text.error}>{error}</Text> : null}

        <View style={styles.amountLine}>
          <Text selectable style={[styles.amount, payment.state === 'voided' ? styles.strike : null]}>{formatCentavos(payment.amountCentavos)}</Text>
          <Text style={text.meta}>received {formatDisplayDate(payment.businessDate)}</Text>
        </View>

        {payment.state === 'voided' ? (
          <View style={styles.voidBox}>
            <Text style={styles.voidTitle}>Void payment</Text>
            <Text selectable style={[text.body, styles.voidText]}>{payment.voidReason}</Text>
          </View>
        ) : null}

        <View style={styles.facts}>
          {facts.map(([label, value]) => (
            <View key={label} style={styles.factRow}>
              <Text style={[text.meta, styles.factLabel]}>{label}</Text>
              <Text selectable style={[text.body, styles.factValue]}>{value}</Text>
            </View>
          ))}
        </View>

        <View style={styles.links}>
          <ActionButton compact variant="secondary" onPress={() => router.push({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': payment.billingStatementId } })}>
            Open Billing Statement
          </ActionButton>
          {serviceReportId ? (
            <ActionButton compact variant="secondary" onPress={() => router.push({ pathname: '/service-reports/[report-id]', params: { 'report-id': serviceReportId } })}>
              Open linked CSR
            </ActionButton>
          ) : null}
        </View>
        <Text style={text.meta}>Payments are never edited. To correct one, void it with a reason; the original stays on record.</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  content: { gap: spacing.lg, padding: spacing.xxl, paddingBottom: 48, maxWidth: 820 },
  amountLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.md },
  amount: { color: colors.label, fontSize: fontSize.title, fontWeight: '600', fontVariant: ['tabular-nums'] },
  strike: { color: colors.secondaryLabel, textDecorationLine: 'line-through' },
  voidBox: { gap: 4, padding: spacing.md, borderRadius: radius.control, backgroundColor: colors.errorTint },
  voidTitle: { color: colors.error, fontSize: fontSize.meta, fontWeight: '600' },
  voidText: { color: colors.error },
  facts: { gap: 10 },
  factRow: { flexDirection: 'row', gap: spacing.lg },
  factLabel: { width: 180 },
  factValue: { flex: 1 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
