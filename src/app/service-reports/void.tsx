import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { Notice } from '@/components/notice';
import { SheetBody, SheetSection } from '@/components/sheet-body';
import { ToggleRow } from '@/components/toggle-row';
import { getServiceReport, voidServiceReport } from '@/features/service-reports/service-report-repository';
import type { ServiceReportDetail } from '@/features/service-reports/service-report-types';

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
    <SheetBody
      error={error}
      actions={
        <>
          <ActionButton disabled={busy} onPress={() => void submit()} variant="danger">
            {busy ? 'Voiding…' : 'Void CSR'}
          </ActionButton>
          <ActionButton disabled={busy} variant="secondary" onPress={() => router.back()}>Cancel</ActionButton>
        </>
      }
    >
      <Notice tone="danger" label={`Void ${report?.csrNumber ?? 'CSR'}`}>
        The original record and number remain in history. Stock corrections are appended, never silently edited.
      </Notice>
      <FormField
        label="Void reason"
        multiline
        onChangeText={setReason}
        style={styles.reason}
        textAlignVertical="top"
        value={reason}
      />
      {report?.usages.length ? (
        <SheetSection title="Items used" hint="Switch on each item that was not used and went back to stock.">
          {report.usages.map((usage) => (
            <ToggleRow
              key={usage.id}
              title={`${usage.itemName} · ${usage.quantity} ${usage.unitLabel}`}
              detail={returned[usage.itemId] ? 'Unused / physically returned to stock' : 'Installed / consumed / not returned'}
              value={returned[usage.itemId] ?? false}
              onValueChange={(value) => setReturned((current) => ({ ...current, [usage.itemId]: value }))}
            />
          ))}
        </SheetSection>
      ) : null}
      <ToggleRow
        title="Create replacement draft"
        detail="Links a new unnumbered CSR to this voided record."
        value={createReissue}
        onValueChange={setCreateReissue}
      />
    </SheetBody>
  );
}

const styles = StyleSheet.create({
  reason: { minHeight: 96 },
});
