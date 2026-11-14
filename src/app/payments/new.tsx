import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ActionButton } from '@/components/action-button';
import { ChoiceChips } from '@/components/choice-chips';
import { DateField } from '@/components/date-field';
import { FormField } from '@/components/form-field';
import { Notice } from '@/components/notice';
import { SheetBody, SheetMessage } from '@/components/sheet-body';
import { getLocalBusinessDate } from '@/domain/business-date';
import { formatCentavos, parseCurrencyToCentavos } from '@/domain/money';
import { getBillingStatement } from '@/features/billing-statements/billing-statement-repository';
import { PAYMENT_METHOD_OPTIONS } from '@/features/payments/payment-methods';
import { renderPaymentAcknowledgment } from '@/features/payments/payment-pdf';
import { createLaterPayment, listPaymentsForStatement } from '@/features/payments/payment-repository';
import type { PaymentMethod, StatementPaymentStatus } from '@/features/payments/payment-types';

export default function NewPaymentScreen() {
  const { statementId } = useLocalSearchParams<{ statementId: string }>();
  const db = useSQLiteContext();
  const requestId = useRef(Crypto.randomUUID());
  const [status, setStatus] = useState<StatementPaymentStatus | null>(null);
  const [replacementDown, setReplacementDown] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getLocalBusinessDate());
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!statementId) return;
    void Promise.all([listPaymentsForStatement(db, statementId), getBillingStatement(db, statementId)])
      .then(([paymentStatus, statement]) => {
        setStatus(paymentStatus);
        const isReplacement = statement?.paymentChoice === 'down_payment' && paymentStatus.activePaidCentavos === 0;
        setReplacementDown(isReplacement);
        setAmount(isReplacement ? '' : String(paymentStatus.balanceCentavos / 100));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load balance.'));
  }, [db, statementId]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await createLaterPayment(db, statementId, {
        idempotencyKey: requestId.current,
        amountCentavos: parseCurrencyToCentavos(amount),
        businessDate: date,
        method,
        referenceNumber: reference,
        note,
      });
      try {
        await renderPaymentAcknowledgment(db, result);
      } catch {
        // The payment is saved; its detail screen offers to generate the acknowledgment again.
      }
      router.replace({ pathname: '/payments/[payment-id]', params: { 'payment-id': result.paymentId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record payment.');
    } finally {
      setBusy(false);
    }
  }, [amount, date, db, method, note, reference, statementId]);

  if (!status) return <SheetMessage>{error ?? 'Loading balance…'}</SheetMessage>;

  return (
    <SheetBody
      error={error}
      actions={
        <>
          <ActionButton disabled={busy} onPress={() => void save()}>
            {busy ? 'Recording…' : 'Record payment and generate acknowledgment'}
          </ActionButton>
          <ActionButton disabled={busy} variant="secondary" onPress={() => router.back()}>Cancel</ActionButton>
        </>
      }
    >
      <Notice
        label={replacementDown ? 'Replacement down payment' : 'Full remaining balance'}
        amount={formatCentavos(status.balanceCentavos)}
      >
        {replacementDown
          ? 'Enter a new down payment below the total. Its remaining balance must later be paid in full.'
          : 'Partial installments are disabled; this payment must equal the displayed balance.'}
      </Notice>
      <FormField
        editable={replacementDown}
        keyboardType="decimal-pad"
        label="Payment amount"
        onChangeText={setAmount}
        value={amount}
      />
      <DateField label="Business date" value={date} onChange={setDate} />
      <ChoiceChips label="Method" options={PAYMENT_METHOD_OPTIONS} value={method} onChange={setMethod} />
      {method !== 'cash' ? <FormField label="Required reference" value={reference} onChangeText={setReference} /> : null}
      <FormField label="Note (optional)" value={note} onChangeText={setNote} />
    </SheetBody>
  );
}
