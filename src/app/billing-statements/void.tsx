import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { Notice } from '@/components/notice';
import { SheetBody, SheetSection } from '@/components/sheet-body';
import { ToggleRow } from '@/components/toggle-row';
import { getBillingStatement, voidBillingStatement } from '@/features/billing-statements/billing-statement-repository';
import type { BillingStatementDetail } from '@/features/billing-statements/billing-statement-types';
import { text } from '@/theme/typography';

export default function VoidBillingStatementScreen() {
  const { statementId } = useLocalSearchParams<{ statementId: string }>();
  const db = useSQLiteContext();
  const [statement, setStatement] = useState<BillingStatementDetail | null>(null);
  const [reason, setReason] = useState('');
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (statementId) {
      void getBillingStatement(db, statementId)
        .then(setStatement)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load statement.'));
    }
  }, [db, statementId]);

  const items = useMemo(() => {
    const result = new Map<string, string>();
    for (const line of statement?.lines ?? []) {
      if (line.lineType === 'item' && !line.sourceCsrUsageId && line.itemId) result.set(line.itemId, line.description);
    }
    return [...result.entries()].map(([id, name]) => ({ id, name }));
  }, [statement]);

  const submit = useCallback(async () => {
    if (!statementId) return;
    setBusy(true);
    setError(null);
    try {
      await voidBillingStatement(
        db,
        statementId,
        reason,
        items.map((item) => ({ itemId: item.id, returnedToStock: choices[item.id] ?? false })),
      );
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not void statement.');
    } finally {
      setBusy(false);
    }
  }, [choices, db, items, reason, statementId]);

  return (
    <SheetBody
      error={error}
      actions={
        <>
          <ActionButton disabled={busy || !reason.trim()} variant="danger" onPress={() => void submit()}>
            {busy ? 'Voiding…' : 'Void statement'}
          </ActionButton>
          <ActionButton disabled={busy} variant="secondary" onPress={() => router.back()}>Cancel</ActionButton>
        </>
      }
    >
      <Notice tone="danger" label="Void finalized statement">
        A paid statement cannot be voided. The number stays used and the frozen PDF remains in history.
      </Notice>
      <FormField
        label="Reason"
        multiline
        onChangeText={setReason}
        placeholder="Why is this statement being voided?"
        style={styles.reason}
        textAlignVertical="top"
        value={reason}
      />
      {items.length ? (
        <SheetSection
          title="Direct item disposition"
          hint="Switch on each directly billed item that physically returned to stock. CSR-linked items are excluded because their stock was deducted by the CSR."
        >
          {items.map((item) => (
            <ToggleRow
              key={item.id}
              title={item.name}
              detail={choices[item.id] ? 'Returned' : 'Not returned'}
              value={choices[item.id] ?? false}
              onValueChange={(value) => setChoices((current) => ({ ...current, [item.id]: value }))}
            />
          ))}
        </SheetSection>
      ) : (
        <Text selectable style={text.meta}>
          This statement has no direct item sale, so no stock disposition is needed.
        </Text>
      )}
    </SheetBody>
  );
}

const styles = StyleSheet.create({
  reason: { minHeight: 96 },
});
