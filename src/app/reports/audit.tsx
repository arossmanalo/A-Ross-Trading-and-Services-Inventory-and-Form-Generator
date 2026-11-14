import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { ChoiceChips } from '@/components/choice-chips';
import { DateField } from '@/components/date-field';
import { FormField } from '@/components/form-field';
import {
  ReportControls,
  ReportEmpty,
  ReportField,
  ReportFieldRow,
  ReportFigure,
  ReportRow,
  ReportSummary,
  reportListStyles,
} from '@/components/report-layout';
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
import { ReportFrame } from '@/components/report-frame';
import { spacing } from '@/theme/typography';

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
    <ReportFrame>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={reportListStyles.content}
        data={visibleRows}
        keyExtractor={row => row.id}
        refreshing={busy}
        onRefresh={() => void generate()}
        ListHeaderComponent={(
          <>
            <ReportControls
              intro="Audit reports show app actions by actual timestamp, including overrides, voids, backdated records, PDF/share events, and settings changes."
              error={error}
              actions={(
                <>
                  <ActionButton disabled={busy} onPress={() => void generate()}>{busy ? 'Working…' : 'Generate audit report'}</ActionButton>
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
                    {exporting ? 'Exporting…' : 'Share filtered audit as CSV'}
                  </ActionButton>
                </>
              )}
            >
              <ReportFieldRow>
                <ReportField><DateField label="From" value={from} onChange={setFrom} disabled={busy} allowFuture /></ReportField>
                <ReportField><DateField label="To" value={to} onChange={setTo} disabled={busy} allowFuture /></ReportField>
              </ReportFieldRow>
              <ChoiceChips
                label="Record type"
                options={AUDIT_ENTITY_FILTERS.map(value => ({ value, label: auditEntityLabel(value) }))}
                value={entityType}
                onChange={setEntityType}
                disabled={busy}
              />
            </ReportControls>
            <ReportSummary>
              <ReportFigure label="Matching audit rows" value={String(visibleRows.length)} />
            </ReportSummary>
            <View style={styles.search}>
              <FormField label="Search loaded audit rows" value={query} onChangeText={setQuery} editable={!busy} />
            </View>
          </>
        )}
        ListEmptyComponent={<ReportEmpty>{busy ? 'Loading…' : 'No audit rows match these filters.'}</ReportEmpty>}
        renderItem={({ item }) => (
          <ReportRow
            title={item.eventType}
            meta={[
              `${auditEntityLabel(item.entityType)} · ${item.entityId}`,
              ...(item.detailsText ? [item.detailsText] : []),
              item.createdAt,
            ]}
          />
        )}
      />
    </ReportFrame>
  );
}

const styles = StyleSheet.create({
  search: { padding: spacing.xl, paddingBottom: spacing.md },
});
