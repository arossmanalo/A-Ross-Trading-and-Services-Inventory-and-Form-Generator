import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { voidQuotation } from '@/features/quotations/quotation-repository';
import { colors } from '@/theme/colors';

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
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.warning}>
        <Text selectable style={styles.warningTitle}>VOID QUOTATION</Text>
        <Text selectable style={styles.warningText}>The quotation stays on record, marked void with your reason. It keeps its number and cannot be edited or reused; issue a new quotation instead.</Text>
      </View>
      <FormField label="Reason" multiline onChangeText={setReason} placeholder="Why is this quotation being voided?" style={styles.reason} textAlignVertical="top" value={reason} />
      {error ? <Text selectable style={styles.error}>{error}</Text> : null}
      <ActionButton disabled={saving || !reason.trim()} variant="danger" onPress={() => void confirm()}>{saving ? 'Voiding…' : 'Void quotation'}</ActionButton>
      <ActionButton disabled={saving} variant="secondary" onPress={() => router.back()}>Cancel</ActionButton>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, padding: 18, paddingBottom: 44 },
  warning: { gap: 6, padding: 16, backgroundColor: '#fee2e2', borderRadius: 16, borderCurve: 'continuous' },
  warningTitle: { color: colors.error, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  warningText: { color: '#7f1d1d', fontSize: 14, lineHeight: 20 },
  reason: { minHeight: 96 },
  error: { color: colors.error, fontSize: 13, fontWeight: '600' },
});
