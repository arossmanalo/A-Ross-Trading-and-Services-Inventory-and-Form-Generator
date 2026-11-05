import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { getDelivery, voidDelivery } from '@/features/deliveries/delivery-repository';
import type { DeliveryDetail } from '@/features/deliveries/delivery-types';
import { colors } from '@/theme/colors';

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
      await voidDelivery(db, deliveryId, reason, delivery.lines.map((line) => ({ itemId: line.itemId, returnedToStock: returned[line.itemId] ?? false })));
      router.back();
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : 'Could not void the delivery.');
    } finally {
      setSaving(false);
    }
  }, [db, delivery, deliveryId, reason, returned]);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.warning}>
        <Text selectable style={styles.warningTitle}>VOID DELIVERY {delivery?.dfNumber ?? ''}</Text>
        <Text selectable style={styles.warningText}>The delivery stays on record, marked void. For each item, say whether it came back so stock is restored only for what was actually returned.</Text>
      </View>
      {delivery?.lines.map((line) => (
        <View key={line.id} style={styles.lineRow}>
          <View style={styles.lineCopy}>
            <Text selectable style={styles.lineTitle}>{line.description}</Text>
            <Text selectable style={styles.help}>{line.quantity} {line.unitLabel} delivered</Text>
          </View>
          <View style={styles.switchCopy}>
            <Text selectable style={styles.help}>Returned to stock</Text>
            <Switch accessibilityLabel={`${line.description} returned to stock`} value={returned[line.itemId] ?? false} onValueChange={(value) => setReturned((current) => ({ ...current, [line.itemId]: value }))} />
          </View>
        </View>
      ))}
      <FormField label="Reason" multiline onChangeText={setReason} placeholder="Why is this delivery being voided?" style={styles.reason} textAlignVertical="top" value={reason} />
      {error ? <Text selectable style={styles.error}>{error}</Text> : null}
      <ActionButton disabled={saving || !delivery || !reason.trim()} variant="danger" onPress={() => void confirm()}>{saving ? 'Voiding…' : 'Void delivery'}</ActionButton>
      <ActionButton disabled={saving} variant="secondary" onPress={() => router.back()}>Cancel</ActionButton>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, padding: 18, paddingBottom: 44 },
  warning: { gap: 6, padding: 16, backgroundColor: '#fee2e2', borderRadius: 16, borderCurve: 'continuous' },
  warningTitle: { color: colors.error, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  warningText: { color: '#7f1d1d', fontSize: 14, lineHeight: 20 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.surface, borderRadius: 14, borderCurve: 'continuous' },
  lineCopy: { flex: 1, gap: 3 },
  lineTitle: { color: colors.label, fontSize: 14, fontWeight: '800' },
  switchCopy: { alignItems: 'center', gap: 4 },
  help: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 17 },
  reason: { minHeight: 96 },
  error: { color: colors.error, fontSize: 13, fontWeight: '600' },
});
