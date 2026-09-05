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
  SALES_LINE_TYPE_FILTERS,
  filterSalesReport,
  getSalesReport,
  lineTypeLabel,
  salesReportCsv,
  type SalesLineTypeFilter,
  type SalesReportRow,
} from '@/features/reports/sales-report';
import { shareCsvReport } from '@/features/reports/report-export';
import { colors } from '@/theme/colors';

const PHP = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

export default function SalesReportScreen() {
  const db = useSQLiteContext();
  const today = getLocalBusinessDate();
  const [from, setFrom] = useState(today.slice(0, 7) + '-01');
  const [to, setTo] = useState(today);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [lineType, setLineType] = useState<SalesLineTypeFilter>('all');
  const [rows, setRows] = useState<SalesReportRow[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCustomer = customers.find(customer => customer.id === customerId);
  const visibleRows = useMemo(() => filterSalesReport(rows, query), [query, rows]);
  const lineSubtotal = visibleRows.reduce((sum, row) => sum + row.amountCentavos, 0);
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
      setRows(await getSalesReport(db, { from, to, customerId, lineType }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load sales report.');
    } finally {
      setBusy(false);
    }
  }, [customerId, db, from, lineType, to]);

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
            Sales rows use finalized Billing Statement business dates. Discounts remain statement-level and are not allocated to individual lines.
          </Text>
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
            {SALES_LINE_TYPE_FILTERS.map(value => (
              <ActionButton key={value} compact variant={lineType === value ? 'primary' : 'secondary'} disabled={busy} onPress={() => setLineType(value)}>
                {lineTypeLabel(value)}
              </ActionButton>
            ))}
          </View>
          <ActionButton disabled={busy} onPress={() => void generate()}>{busy ? 'Working...' : 'Generate sales report'}</ActionButton>
          <FormField label="Search loaded rows" value={query} onChangeText={setQuery} editable={!busy} />
          <Text selectable>{visibleRows.length} matching lines - {PHP.format(lineSubtotal / 100)} line subtotal before statement discounts</Text>
          <ActionButton
            variant="secondary"
            disabled={busy || exporting || visibleRows.length === 0}
            onPress={() => {
              setExporting(true);
              setError(null);
              void shareCsvReport(salesReportCsv(visibleRows), 'sales-lines-report')
                .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Export failed.'))
                .finally(() => setExporting(false));
            }}
          >
            {exporting ? 'Exporting...' : 'Share filtered sales as CSV'}
          </ActionButton>
          {error ? <Text selectable style={{ color: colors.error }}>{error}</Text> : null}
        </View>
      )}
      ListEmptyComponent={<Text selectable>{busy ? 'Loading...' : 'No sales lines match these filters.'}</Text>}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': item.billingStatementId } })}
          style={{ padding: 16, gap: 6, borderRadius: 12, backgroundColor: colors.surface }}
        >
          <Text selectable style={{ color: colors.label, fontWeight: '800' }}>{item.description}</Text>
          <Text selectable style={{ color: colors.secondaryLabel }}>{item.customerName} - {item.billingStatementNumber ?? 'Billing Statement'}{item.serviceReportNumber ? ` - ${item.serviceReportNumber}` : ''}</Text>
          <Text selectable style={{ color: colors.secondaryLabel }}>
            {lineTypeLabel(item.lineType)} - {item.quantity} x {PHP.format(item.unitPriceCentavos / 100)} = {PHP.format(item.amountCentavos / 100)}
          </Text>
          {item.overrideReason ? <Text selectable style={{ color: colors.warning }}>Override: {item.overrideReason}</Text> : null}
        </Pressable>
      )}
    />
  );
}
