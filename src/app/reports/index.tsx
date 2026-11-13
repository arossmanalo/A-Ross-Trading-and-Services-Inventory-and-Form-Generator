import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { DateField } from '@/components/date-field';
import { FormField } from '@/components/form-field';
import { ReportFrame } from '@/components/report-frame';
import { getLocalBusinessDate } from '@/domain/business-date';
import { formatDisplayDate } from '@/domain/calendar';
import { listCustomers } from '@/features/customers/customer-repository';
import type { CustomerSummary } from '@/features/customers/customer-types';
import { FINANCIAL_METRICS, getFinancialReport, type FinancialReport, type ReportFilter } from '@/features/reports/financial-report';
import { shareFinancialReport } from '@/features/reports/report-export';
import { colors } from '@/theme/colors';
import { fontSize, radius, spacing, text } from '@/theme/typography';

const PHP = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
type LoadedReport = { report: FinancialReport; filter: ReportFilter; customerName: string };

export default function FinancialReportsScreen() {
  const db = useSQLiteContext();
  const today = getLocalBusinessDate();
  const [from, setFrom] = useState(today.slice(0, 7) + '-01');
  const [to, setTo] = useState(today);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState<LoadedReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);

  useFocusEffect(useCallback(() => {
    const request = ++version.current;
    void listCustomers(db)
      .then((rows) => { if (request === version.current) setCustomers(rows); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load customers.'));
    return () => { version.current++; };
  }, [db]));

  const generate = async () => {
    const request = ++version.current;
    setBusy(true);
    setError(null);
    const filter = { from, to, customerId };
    try {
      const report = await getFinancialReport(db, filter);
      if (request === version.current) {
        setLoaded({ report, filter, customerName: customers.find((c) => c.id === customerId)?.name ?? 'All customers' });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not calculate report.');
    } finally {
      setBusy(false);
    }
  };

  const selectedName = customers.find((c) => c.id === customerId)?.name ?? 'All customers';
  const matches = query.trim()
    ? customers.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 15)
    : [];

  return (
    <ReportFrame>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text style={text.meta}>
          Sales and expenses use statement dates. Collections use payment dates. Outstanding shows today’s balance on statements from the selected period.
        </Text>
        <View style={styles.filters}>
          <View style={styles.dateField}><DateField label="From" value={from} onChange={setFrom} disabled={busy} allowFuture /></View>
          <View style={styles.dateField}><DateField label="To" value={to} onChange={setTo} disabled={busy} allowFuture /></View>
          <FormField containerStyle={styles.customerField} label="Find customer (including inactive)" value={query} onChangeText={setQuery} placeholder={selectedName} />
          <ActionButton compact variant={customerId ? 'secondary' : 'primary'} disabled={busy} onPress={() => setCustomerId('')}>All customers</ActionButton>
        </View>
        {matches.length ? (
          <View style={styles.matches}>
            {matches.map((c, index) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                disabled={busy}
                onPress={() => { setCustomerId(c.id); setQuery(''); }}
                style={({ pressed }) => [styles.match, index > 0 ? styles.matchDivider : null, pressed ? styles.pressed : null]}
              >
                <Text style={text.body}>{c.name}{c.active ? '' : ' (inactive)'}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={styles.generateRow}>
          <Text style={text.meta}>Customer: <Text style={text.bodyStrong}>{selectedName}</Text></Text>
          <ActionButton compact disabled={busy} onPress={() => void generate()}>{busy ? 'Working…' : 'Generate report'}</ActionButton>
        </View>
        {error ? <Text accessibilityLiveRegion="polite" style={text.error}>{error}</Text> : null}

        {loaded ? (
          <>
            <View style={styles.resultsHeading}>
              <Text accessibilityRole="header" style={text.subhead}>
                {formatDisplayDate(loaded.filter.from)} to {formatDisplayDate(loaded.filter.to)} · {loaded.customerName}
              </Text>
              <Text style={text.meta}>{loaded.report.statementCount} finalized statement{loaded.report.statementCount === 1 ? '' : 's'}</Text>
            </View>
            <View style={styles.grid}>
              {FINANCIAL_METRICS.map(({ key, label }) => (
                <View key={key} style={styles.metric}>
                  <Text style={text.meta}>{label}</Text>
                  <Text selectable style={styles.metricValue}>{PHP.format(loaded.report[key] / 100)}</Text>
                </View>
              ))}
            </View>
            <Text style={text.meta}>Net Revenue After Recorded Expenses excludes untracked item acquisition and internal labor costs.</Text>
            <ActionButton
              compact
              variant="secondary"
              disabled={busy}
              style={styles.share}
              onPress={() => {
                setBusy(true);
                setError(null);
                void shareFinancialReport(loaded.report, loaded.filter, loaded.customerName)
                  .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Export failed.'))
                  .finally(() => setBusy(false));
              }}
            >
              Share these results as CSV
            </ActionButton>
          </>
        ) : null}
      </ScrollView>
    </ReportFrame>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xxl, gap: spacing.lg, paddingBottom: 48 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: spacing.lg },
  dateField: { flexBasis: 180, flexGrow: 1, maxWidth: 240 },
  customerField: { flexBasis: 260, flexGrow: 2 },
  matches: {
    maxWidth: 520,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: radius.panel,
    overflow: 'hidden',
  },
  match: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.lg },
  matchDivider: { borderTopWidth: 1, borderTopColor: colors.hairline },
  pressed: { backgroundColor: colors.subtleSurface },
  generateRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  resultsHeading: { gap: 2, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.separator },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: radius.panel,
    overflow: 'hidden',
  },
  metric: {
    flexBasis: 220,
    flexGrow: 1,
    gap: 4,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.hairline,
  },
  metricValue: { color: colors.label, fontSize: fontSize.section, fontWeight: '600', fontVariant: ['tabular-nums'] },
  share: { alignSelf: 'flex-start' },
});
