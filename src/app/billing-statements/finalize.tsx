import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { ChoiceChips } from '@/components/choice-chips';
import { DateField } from '@/components/date-field';
import { FormField } from '@/components/form-field';
import { Fact } from '@/components/record-layout';
import { Notice } from '@/components/notice';
import { OptionRow } from '@/components/option-row';
import { SheetBody, SheetMessage, SheetSection } from '@/components/sheet-body';
import { getLocalBusinessDate } from '@/domain/business-date';
import { formatCentavos, parseCurrencyToCentavos } from '@/domain/money';
import { finalizeAndRenderBillingStatement } from '@/features/billing-statements/billing-statement-pdf';
import { BillingDraftPriceChangedError, getBillingStatement } from '@/features/billing-statements/billing-statement-repository';
import type { BillingStatementDetail } from '@/features/billing-statements/billing-statement-types';
import { PAYMENT_METHOD_OPTIONS } from '@/features/payments/payment-methods';
import type { InitialPaymentSelection, PaymentMethod } from '@/features/payments/payment-types';
import { spacing, text } from '@/theme/typography';

type Choice = InitialPaymentSelection['choice'];

export default function FinalizeBillingStatementScreen() {
  const { statementId } = useLocalSearchParams<{ statementId: string }>();
  const db = useSQLiteContext();
  const [statement, setStatement] = useState<BillingStatementDetail | null>(null);
  const [choice, setChoice] = useState<Choice>('pay_later');
  const [amount, setAmount] = useState('');
  const [businessDate, setBusinessDate] = useState(getLocalBusinessDate());
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (statementId) {
      void getBillingStatement(db, statementId)
        .then(setStatement)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load statement.'));
    }
  }, [db, statementId]);

  const finalize = useCallback(async (policy: 'reject' | 'keep-draft' | 'use-current' = 'reject') => {
    if (!statement) return;
    setBusy(true);
    setError(null);
    try {
      const selection: InitialPaymentSelection = choice === 'pay_later'
        ? { choice }
        : {
          choice,
          payment: {
            amountCentavos: choice === 'paid_in_full' ? statement.discountedTotalCentavos : parseCurrencyToCentavos(amount),
            businessDate,
            method,
            referenceNumber: reference,
            note,
          },
        };
      const result = await finalizeAndRenderBillingStatement(db, statementId, policy, selection);
      Alert.alert(
        'Statement finalized',
        `${result.bsNumber} and ${result.paymentId ? 'its Payment Acknowledgment' : 'the Billing Statement PDF'} are ready.`,
      );
      router.replace({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': statementId } });
    } catch (e) {
      if (e instanceof BillingDraftPriceChangedError) {
        Alert.alert('Prices changed', e.message, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Keep draft prices', onPress: () => void finalize('keep-draft') },
          { text: 'Use current prices', onPress: () => void finalize('use-current') },
        ]);
      } else {
        const latest = await getBillingStatement(db, statementId);
        if (latest?.documentState === 'finalized') {
          Alert.alert(
            'Finalized with a PDF issue',
            'The business records are safe. Open the statement or payment to retry its PDF.',
          );
          router.replace({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': statementId } });
        } else {
          setError(e instanceof Error ? e.message : 'Could not finalize statement.');
        }
      }
    } finally {
      setBusy(false);
    }
  }, [amount, businessDate, choice, db, method, note, reference, statement, statementId]);

  if (!statement) return <SheetMessage>{error ?? 'Loading…'}</SheetMessage>;

  const needsPayment = choice !== 'pay_later';
  return (
    <SheetBody
      error={error}
      actions={
        <>
          <ActionButton disabled={busy} onPress={() => void finalize()}>
            {busy ? 'Finalizing…' : 'Finalize and generate documents'}
          </ActionButton>
          <ActionButton disabled={busy} variant="secondary" onPress={() => router.back()}>Cancel</ActionButton>
        </>
      }
    >
      <Notice label="Finalization" amount={formatCentavos(statement.discountedTotalCentavos)}>
        Finalization freezes the statement, allocates its number, and posts direct inventory sales.
      </Notice>
      <SheetSection title="Payment choice">
        <View accessibilityRole="radiogroup" style={styles.choices}>
          <OptionRow
            label="Pay Later"
            detail="No initial payment"
            selected={choice === 'pay_later'}
            onPress={() => setChoice('pay_later')}
          />
          <OptionRow
            label="Paid in Full"
            detail={formatCentavos(statement.discountedTotalCentavos)}
            selected={choice === 'paid_in_full'}
            onPress={() => setChoice('paid_in_full')}
          />
          <OptionRow
            label="Down Payment"
            detail="One deposit, then the full balance"
            selected={choice === 'down_payment'}
            onPress={() => setChoice('down_payment')}
          />
        </View>
      </SheetSection>
      {needsPayment ? (
        <SheetSection title="Payment details">
          {choice === 'down_payment' ? (
            <FormField
              keyboardType="decimal-pad"
              label="Down payment amount"
              onChangeText={setAmount}
              placeholder="0.00"
              value={amount}
            />
          ) : (
            <Fact label="Payment amount">
              <Text selectable style={[text.subhead, styles.amount]}>
                {formatCentavos(statement.discountedTotalCentavos)}
              </Text>
            </Fact>
          )}
          <DateField label="Payment business date" value={businessDate} onChange={setBusinessDate} />
          <ChoiceChips label="Method" options={PAYMENT_METHOD_OPTIONS} value={method} onChange={setMethod} />
          {method !== 'cash' ? (
            <FormField
              label="Required reference"
              onChangeText={setReference}
              placeholder="Transaction or check reference"
              value={reference}
            />
          ) : null}
          <FormField label="Note (optional)" value={note} onChangeText={setNote} />
        </SheetSection>
      ) : null}
    </SheetBody>
  );
}

const styles = StyleSheet.create({
  choices: { gap: spacing.sm },
  amount: { fontVariant: ['tabular-nums'] },
});
