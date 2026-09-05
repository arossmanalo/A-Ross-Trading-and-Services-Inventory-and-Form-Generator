import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { getLocalBusinessDate } from '@/domain/business-date';
import {
  AUDIT_ENTITY_FILTERS,
  auditEntityLabel,
  auditReportCsv,
  filterAuditReport,
  getAuditReport,
  type AuditEntityFilter,
  type AuditReportRow,
} from '@/features/reports/audit-report';
import { shareCsvReport } from '@/features/reports/report-export';
import { colors } from '@/theme/colors';

export default function AuditReportScreen() {
  const db = useSQLiteContext();
  const today = getLocalBusinessDate();
  const [from, setFrom] = useState(today.slice(0, 7) + '-01');
  const [to, setTo] = useState(today);
  const [entityType, setEntityType] = useState<AuditEntityFilter>('all');
  const [rows, setRows] = useState<AuditReportRow[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleRows = useMemo(() => filterAuditReport(rows, query), [query, rows]);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setRows(await getAuditReport(db, { from, to, entityType }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load audit report.');
    } finally {
      setBusy(false);
    }
  }, [db, entityType, from, to]);

  useFocusEffect(useCallback(() => {
    void generate();
  }, [generate]));

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: 44 }}
      data={visibleRows}
      keyExtractor={row => row.id}
      refreshing={busy}
      onRefresh={() => void generate()}
      ListHeaderComponent={(
        <View style={{ gap: 14, marginBottom: 16 }}>
          <Text selectable>
            Audit reports show app actions by actual timestamp, including overrides, voids,
            backdated records, PDF/share events, and settings changes.
          </Text>
          <FormField label="From (YYYY-MM-DD)" value={from} onChangeText={setFrom} editable={!busy} />
          <FormField label="To (YYYY-MM-DD)" value={to} onChangeText={setTo} editable={!busy} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {AUDIT_ENTITY_FILTERS.map(value => (
              <ActionButton
                key={value}
                compact
                variant={entityType === value ? 'primary' : 'secondary'}
                disabled={busy}
                onPress={() => setEntityType(value)}
              >
                {auditEntityLabel(value)}
              </ActionButton>
            ))}
          </View>
          <ActionButton disabled={busy} onPress={() => void generate()}>{busy ? 'Working...' : 'Generate audit report'}</ActionButton>
          <FormField label="Search loaded audit rows" value={query} onChangeText={setQuery} editable={!busy} />
          <Text selectable>{visibleRows.length} matching audit rows</Text>
          <ActionButton
            variant="secondary"
            disabled={busy || exporting || visibleRows.length === 0}
            onPress={() => {
              setExporting(true);
              setError(null);
              void shareCsvReport(auditReportCsv(visibleRows), 'audit-report')
                .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Export failed.'))
                .finally(() => setExporting(false));
            }}
          >
            {exporting ? 'Exporting...' : 'Share filtered audit as CSV'}
          </ActionButton>
          {error ? <Text selectable style={{ color: colors.error }}>{error}</Text> : null}
        </View>
      )}
      ListEmptyComponent={<Text selectable>{busy ? 'Loading...' : 'No audit rows match these filters.'}</Text>}
      renderItem={({ item }) => (
        <View style={{ padding: 16, gap: 6, borderRadius: 12, backgroundColor: colors.surface }}>
          <Text selectable style={{ color: colors.label, fontWeight: '800' }}>{item.eventType}</Text>
          <Text selectable style={{ color: colors.secondaryLabel }}>
            {auditEntityLabel(item.entityType)} - {item.entityId}
          </Text>
          {item.detailsText ? <Text selectable style={{ color: colors.secondaryLabel }}>{item.detailsText}</Text> : null}
          <Text selectable style={{ color: colors.secondaryLabel }}>{item.createdAt}</Text>
        </View>
      )}
    />
  );
}
