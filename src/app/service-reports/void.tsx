import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { getServiceReport, voidServiceReport } from '@/features/service-reports/service-report-repository';
import type { ServiceReportDetail } from '@/features/service-reports/service-report-types';
import { colors } from '@/theme/colors';

export default function VoidServiceReportScreen() {
  const { reportId } = useLocalSearchParams<{ reportId: string }>();
  const db = useSQLiteContext();
  const [report, setReport] = useState<ServiceReportDetail | null>(null);
  const [reason, setReason] = useState('');
  const [returned, setReturned] = useState<Record<string, boolean>>({});
  const [createReissue, setCreateReissue] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reportId) return;
    void getServiceReport(db, reportId)
      .then((value) => {
        if (!value) throw new Error('CSR was not found.');
        setReport(value);
        setReturned(Object.fromEntries(value.usages.map((usage) => [usage.itemId, false])));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load CSR.'));
  }, [db, reportId]);

  const submit = useCallback(async () => {
    if (!reportId || !report) return;
    setBusy(true);
    setError(null);
    try {
      const reissueId = await voidServiceReport(
        db,
        reportId,
        reason,
        report.usages.map((usage) => ({ itemId: usage.itemId, returnedToStock: returned[usage.itemId] ?? false })),
        createReissue,
      );
      if (reissueId) {
        router.replace({ pathname: '/service-reports/[report-id]', params: { 'report-id': reissueId } });
      } else {
        router.back();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not void CSR.');
    } finally {
      setBusy(false);
    }
  }, [createReissue, db, reason, report, reportId, returned]);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <View style={styles.warning}>
        <Text selectable style={styles.warningTitle}>Void {report?.csrNumber ?? 'CSR'}</Text>
        <Text selectable style={styles.warningText}>The original record and number remain in history. Stock corrections are appended, never silently edited.</Text>
      </View>
      <FormField label="Void reason" multiline onChangeText={setReason} style={styles.multiline} textAlignVertical="top" value={reason} />
      {report?.usages.map((usage) => (
        <View key={usage.id} style={styles.disposition}>
          <View style={styles.copy}>
            <Text selectable style={styles.itemName}>{usage.itemName} · {usage.quantity} {usage.unitLabel}</Text>
            <Text selectable style={styles.help}>{returned[usage.itemId] ? 'Unused / physically returned to stock' : 'Installed / consumed / not returned'}</Text>
          </View>
          <Switch accessibilityLabel={`${usage.itemName} returned to stock`} onValueChange={(value) => setReturned((current) => ({ ...current, [usage.itemId]: value }))} value={returned[usage.itemId] ?? false} />
        </View>
      ))}
      <View style={styles.disposition}>
        <View style={styles.copy}><Text selectable style={styles.itemName}>Create replacement draft</Text><Text selectable style={styles.help}>Links a new unnumbered CSR to this voided record.</Text></View>
        <Switch accessibilityLabel="Create replacement draft" onValueChange={setCreateReissue} value={createReissue} />
      </View>
      {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
      <ActionButton disabled={busy} onPress={() => void submit()} variant="danger">{busy ? 'Voiding…' : 'Void CSR'}</ActionButton>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, padding: 18, paddingBottom: 44 },
  warning: { gap: 6, padding: 16, backgroundColor: '#ffebe9', borderRadius: 16, borderCurve: 'continuous' },
  warningTitle: { color: colors.error, fontSize: 18, fontWeight: '900' },
  warningText: { color: colors.label, fontSize: 13, lineHeight: 19 },
  multiline: { minHeight: 90 },
  disposition: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderWidth: 1, borderColor: colors.separator, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.surface },
  copy: { flex: 1, gap: 4 },
  itemName: { color: colors.label, fontSize: 14, fontWeight: '800' },
  help: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 17 },
  errorText: { color: colors.error, fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
