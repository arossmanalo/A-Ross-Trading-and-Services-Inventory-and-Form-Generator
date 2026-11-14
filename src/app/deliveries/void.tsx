import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { Notice } from '@/components/notice';
import { SheetBody, SheetSection } from '@/components/sheet-body';
import { ToggleRow } from '@/components/toggle-row';
import { getDelivery, voidDelivery } from '@/features/deliveries/delivery-repository';
import type { DeliveryDetail } from '@/features/deliveries/delivery-types';

export default function VoidDeliveryScreen() {
  const { deliveryId } = useLocalSearchParams<{ deliveryId: string }>();
  const db = useSQLiteContext();
  const [delivery, setDelivery] = useState<DeliveryDetail | null>(null);
  const [reason, setReason] = useState('');
  const [returned, setReturned] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!deliveryId) return;
    void getDelivery(db, deliveryId).then((result) => {
      setDelivery(result);
      setReturned(Object.fromEntries((result?.lines ?? []).map((line) => [line.itemId, true])));
    }).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load the delivery.'));
  }, [db, deliveryId]);

  const confirm = useCallback(async () => {
    if (!deliveryId || !delivery) return;
    setSaving(true);
    setError(null);
    try {
      await voidDelivery(
        db,
        deliveryId,
        reason,
        delivery.lines.map((line) => ({ itemId: line.itemId, returnedToStock: returned[line.itemId] ?? false })),
      );
      router.back();
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : 'Could not void the delivery.');
    } finally {
      setSaving(false);
    }
  }, [db, delivery, deliveryId, reason, returned]);

  return (
    <SheetBody
      error={error}
      actions={
        <>
          <ActionButton disabled={saving || !delivery || !reason.trim()} variant="danger" onPress={() => void confirm()}>
            {saving ? 'Voiding…' : 'Void delivery'}
          </ActionButton>
          <ActionButton disabled={saving} variant="secondary" onPress={() => router.back()}>Cancel</ActionButton>
        </>
      }
    >
      <Notice tone="danger" label={`Void delivery ${delivery?.dfNumber ?? ''}`.trim()}>
        The delivery stays on record, marked void. For each item, say whether it came back so stock is restored
        only for what was actually returned.
      </Notice>
      {delivery?.lines.length ? (
        <SheetSection title="Items delivered">
          {delivery.lines.map((line) => (
            <ToggleRow
              key={line.id}
              title={line.description}
              detail={`${line.quantity} ${line.unitLabel} delivered · ${returned[line.itemId] ? 'Returned to stock' : 'Not returned'}`}
              value={returned[line.itemId] ?? false}
              onValueChange={(value) => setReturned((current) => ({ ...current, [line.itemId]: value }))}
            />
          ))}
        </SheetSection>
      ) : null}
      <FormField
        label="Reason"
        multiline
        onChangeText={setReason}
        placeholder="Why is this delivery being voided?"
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
