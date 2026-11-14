import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { Notice } from '@/components/notice';
import { SheetBody } from '@/components/sheet-body';
import { voidPayment } from '@/features/payments/payment-repository';

export default function VoidPaymentScreen() {
  const { paymentId } = useLocalSearchParams<{ paymentId: string }>();
  const db = useSQLiteContext();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await voidPayment(db, paymentId, reason);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not void payment.');
    } finally {
      setBusy(false);
    }
  }, [db, paymentId, reason]);

  return (
    <SheetBody
      error={error}
      actions={
        <>
          <ActionButton disabled={busy || !reason.trim()} variant="danger" onPress={() => void submit()}>
            {busy ? 'Voiding…' : 'Void payment'}
          </ActionButton>
          <ActionButton disabled={busy} variant="secondary" onPress={() => router.back()}>Cancel</ActionButton>
        </>
      }
    >
      <Notice tone="danger" label="Void payment">
        The PA number and original acknowledgment remain in history. Voided amounts stop counting toward the
        statement balance.
      </Notice>
      <FormField
        label="Reason"
        multiline
        onChangeText={setReason}
        placeholder="Why is this payment being voided?"
        style={styles.reason}
        textAlignVertical="top"
        value={reason}
      />
    </SheetBody>
  );
}

const styles = StyleSheet.create({
  reason: { minHeight: 96 },
});
