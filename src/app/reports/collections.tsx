import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
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
import { colors } from '@/theme/colors';

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
          <Text selectable>Collections use payment business dates. Voided payments can be shown for review but do not count toward active collected totals.</Text>
          <FormField label="From (YYYY-MM-DD)" value={from} onChangeText={setFrom} editable={!busy} />
          <FormField label="To (YYYY-MM-DD)" value={to} onChangeText={setTo} editable={!busy} />
          <FormField label="Find customer" value={customerQuery} onChangeText={setCustomerQuery} editable={!busy} />
          <ActionButton variant={customerId ? 'secondary' : 'primary'} disabled={busy} onPress={() => setCustomerId('')}>All customers</ActionButton>
          <Text selectable>Selected customer: {selectedCustomer?.name ?? 'All customers'}</Text>
          {matchingCustomers.map(customer => (
            <Pressable
              key={customer.id}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                setCustomerId(customer.id);
                setCustomerQuery('');
              }}
              style={{ padding: 14, backgroundColor: colors.surface, borderRadius: 10 }}
            >
              <Text selectable style={{ color: colors.label, fontWeight: '700' }}>{customer.name}{customer.active ? '' : ' (inactive)'}</Text>
            </Pressable>
          ))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {COLLECTION_STATE_FILTERS.map(value => (
              <ActionButton key={value} compact variant={state === value ? 'primary' : 'secondary'} disabled={busy} onPress={() => setState(value)}>
                {value.charAt(0).toUpperCase() + value.slice(1)}
              </ActionButton>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {COLLECTION_METHOD_FILTERS.map(value => (
              <ActionButton key={value} compact variant={method === value ? 'primary' : 'secondary'} disabled={busy} onPress={() => setMethod(value)}>
                {methodLabel(value)}
              </ActionButton>
            ))}
          </View>
          <ActionButton disabled={busy} onPress={() => void generate()}>{busy ? 'Working...' : 'Generate collections report'}</ActionButton>
          <FormField label="Search loaded rows" value={query} onChangeText={setQuery} editable={!busy} />
          <Text selectable>{visibleRows.length} matching payments - {PHP.format(activeTotal / 100)} active collected</Text>
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
            {exporting ? 'Exporting...' : 'Share filtered collections as CSV'}
          </ActionButton>
          {error ? <Text selectable style={{ color: colors.error }}>{error}</Text> : null}
        </View>
      )}
      ListEmptyComponent={<Text selectable>{busy ? 'Loading...' : 'No payments match these filters.'}</Text>}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/payments/[payment-id]', params: { 'payment-id': item.id } })}
          style={{ padding: 16, gap: 6, borderRadius: 12, backgroundColor: colors.surface }}
        >
          <Text selectable style={{ color: colors.label, fontWeight: '800' }}>{item.paNumber ?? 'Payment'} - {PHP.format(item.amountCentavos / 100)}</Text>
          <Text selectable style={{ color: colors.secondaryLabel }}>{item.customerName} - {item.billingStatementNumber ?? 'Billing Statement'}</Text>
          <Text selectable style={{ color: colors.secondaryLabel }}>{item.businessDate} - {methodLabel(item.method)}{item.referenceNumber ? ` - ${item.referenceNumber}` : ''}</Text>
          {item.state === 'voided' ? <Text selectable style={{ color: colors.error }}>Voided: {item.voidReason ?? 'No reason recorded'}</Text> : null}
        </Pressable>
      )}
    />
  );
}
