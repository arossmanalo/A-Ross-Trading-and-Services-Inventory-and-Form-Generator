import { router, useFocusEffect } from 'expo-router';
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
  ReportScope,
  ReportSummary,
  reportListStyles,
} from '@/components/report-layout';
import { getLocalBusinessDate } from '@/domain/business-date';
import { listCustomers } from '@/features/customers/customer-repository';
import type { CustomerSummary } from '@/features/customers/customer-types';
import {
  COLLECTION_METHOD_FILTERS,
  COLLECTION_STATE_FILTERS,
  collectionsReportCsv,
  filterCollectionsReport,
  getCollectionsReport,
  methodLabel,
  sumActiveCollections,
  type CollectionMethodFilter,
  type CollectionStateFilter,
  type CollectionsReportRow,
} from '@/features/reports/collections-report';
import { shareCsvReport } from '@/features/reports/report-export';
import { ReportFrame } from '@/components/report-frame';
import { spacing } from '@/theme/typography';

const PHP = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

export default function CollectionsReportScreen() {
  const db = useSQLiteContext();
  const today = getLocalBusinessDate();
  const [from, setFrom] = useState(today.slice(0, 7) + '-01');
  const [to, setTo] = useState(today);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [state, setState] = useState<CollectionStateFilter>('active');
  const [method, setMethod] = useState<CollectionMethodFilter>('all');
  const [rows, setRows] = useState<CollectionsReportRow[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCustomer = customers.find(customer => customer.id === customerId);
  const visibleRows = useMemo(() => filterCollectionsReport(rows, query), [query, rows]);
  const activeTotal = sumActiveCollections(visibleRows);
  const matchingCustomers = customerQuery.trim()
    ? customers.filter(customer => customer.name.toLowerCase().includes(customerQuery.trim().toLowerCase())).slice(0, 12)
    : [];

  useFocusEffect(useCallback(() => {
    let active = true;
    setError(null);
    void listCustomers(db)
      .then(nextCustomers => {
        if (active) setCustomers(nextCustomers);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not load customers.');
      });
    return () => {
      active = false;
    };
  }, [db]));

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setRows(await getCollectionsReport(db, { from, to, customerId, state, method }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load collections report.');
    } finally {
      setBusy(false);
    }
  }, [customerId, db, from, method, state, to]);

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
              intro="Collections use payment business dates. Voided payments can be shown for review but do not count toward active collected totals."
              error={error}
              actions={(
                <>
                  <ActionButton disabled={busy} onPress={() => void generate()}>{busy ? 'Working…' : 'Generate collections report'}</ActionButton>
                  <ActionButton
                    variant="secondary"
                    disabled={busy || exporting || visibleRows.length === 0}
                    onPress={() => {
                      setExporting(true);
                      setError(null);
                      void shareCsvReport(collectionsReportCsv(visibleRows), 'collections-report')
                        .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Export failed.'))
                        .finally(() => setExporting(false));
                    }}
                  >
                    {exporting ? 'Exporting…' : 'Share filtered collections as CSV'}
                  </ActionButton>
                </>
              )}
            >
              <ReportFieldRow>
                <ReportField><DateField label="From" value={from} onChange={setFrom} disabled={busy} allowFuture /></ReportField>
                <ReportField><DateField label="To" value={to} onChange={setTo} disabled={busy} allowFuture /></ReportField>
              </ReportFieldRow>
              <ReportScope
                label="Find customer"
                allLabel="All customers"
                query={customerQuery}
                onQueryChange={setCustomerQuery}
                selectedTitle={selectedCustomer?.name ?? null}
                onClear={() => setCustomerId('')}
                matches={matchingCustomers.map(customer => ({
                  id: customer.id,
                  title: `${customer.name}${customer.active ? '' : ' (inactive)'}`,
                }))}
                onPick={(id) => {
                  setCustomerId(id);
                  setCustomerQuery('');
                }}
                disabled={busy}
              />
              <ChoiceChips
                label="Status"
                options={COLLECTION_STATE_FILTERS.map(value => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }))}
                value={state}
                onChange={setState}
                disabled={busy}
              />
              <ChoiceChips
                label="Method"
                options={COLLECTION_METHOD_FILTERS.map(value => ({ value, label: methodLabel(value) }))}
                value={method}
                onChange={setMethod}
                disabled={busy}
              />
            </ReportControls>
            <ReportSummary>
              <ReportFigure label="Matching payments" value={String(visibleRows.length)} />
              <ReportFigure label="Active collected" value={PHP.format(activeTotal / 100)} />
            </ReportSummary>
            <View style={styles.search}>
              <FormField label="Search loaded rows" value={query} onChangeText={setQuery} editable={!busy} />
            </View>
          </>
        )}
        ListEmptyComponent={<ReportEmpty>{busy ? 'Loading…' : 'No payments match these filters.'}</ReportEmpty>}
        renderItem={({ item }) => (
          <ReportRow
            title={item.paNumber ?? 'Payment'}
            figure={PHP.format(item.amountCentavos / 100)}
            meta={[
              `${item.customerName} · ${item.billingStatementNumber ?? 'Billing Statement'}`,
              `${item.businessDate} · ${methodLabel(item.method)}${item.referenceNumber ? ` · ${item.referenceNumber}` : ''}`,
            ]}
            note={item.state === 'voided' ? { text: `Voided: ${item.voidReason ?? 'No reason recorded'}`, tone: 'error' } : null}
            onPress={() => router.push({ pathname: '/payments/[payment-id]', params: { 'payment-id': item.id } })}
          />
        )}
      />
    </ReportFrame>
  );
}

const styles = StyleSheet.create({
  search: { padding: spacing.xl, paddingBottom: spacing.md },
});
