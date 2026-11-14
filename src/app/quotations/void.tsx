import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { Notice } from '@/components/notice';
import { SheetBody } from '@/components/sheet-body';
import { voidQuotation } from '@/features/quotations/quotation-repository';

export default function VoidQuotationScreen() {
  const { quotationId } = useLocalSearchParams<{ quotationId: string }>();
  const db = useSQLiteContext();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const confirm = useCallback(async () => {
    if (!quotationId) return;
    setSaving(true);
    setError(null);
    try {
      await voidQuotation(db, quotationId, reason);
      router.back();
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : 'Could not void the quotation.');
    } finally {
      setSaving(false);
    }
  }, [db, quotationId, reason]);

  return (
    <SheetBody
      error={error}
      actions={
        <>
          <ActionButton disabled={saving || !reason.trim()} variant="danger" onPress={() => void confirm()}>
            {saving ? 'Voiding…' : 'Void quotation'}
          </ActionButton>
          <ActionButton disabled={saving} variant="secondary" onPress={() => router.back()}>Cancel</ActionButton>
        </>
      }
    >
      <Notice tone="danger" label="Void quotation">
        The quotation stays on record, marked void with your reason. It keeps its number and cannot be edited or
        reused; issue a new quotation instead.
      </Notice>
      <FormField
        label="Reason"
        multiline
        onChangeText={setReason}
        placeholder="Why is this quotation being voided?"
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
