import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ListEmpty, listRowStyles, ListSearch, ListTitle } from '@/components/list-pane';
import { SplitView, useSplitLayout } from '@/components/split-view';
import { StatusChip, sentenceCase } from '@/components/status-chip';
import { formatDisplayDate } from '@/domain/calendar';
import { filterPaymentsByQuery } from '@/domain/payment-search';
import { formatCentavos } from '@/domain/money';
import { PaymentDetailView } from '@/features/payments/payment-detail-view';
import { listPayments } from '@/features/payments/payment-repository';
import type { PaymentSummary } from '@/features/payments/payment-types';
import { colors } from '@/theme/colors';
import { spacing, text } from '@/theme/typography';

type PaymentRowProps = { payment: PaymentSummary; selected: boolean; onOpen: (paymentId: string) => void };

const PaymentRow = memo(function PaymentRow({ payment, selected, onOpen }: PaymentRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onOpen(payment.id)}
      style={({ pressed }) => [listRowStyles.row, selected ? listRowStyles.selected : null, pressed && !selected ? listRowStyles.pressed : null]}
    >
      <View style={listRowStyles.titleLine}>
        <Text style={listRowStyles.number}>{payment.paNumber}</Text>
        <StatusChip label={payment.state === 'active' ? 'Active' : 'Void'} tone={payment.state === 'active' ? 'final' : 'void'} />
      </View>
      <Text numberOfLines={1} style={text.bodyStrong}>{payment.customerName}</Text>
      <View style={listRowStyles.metaLine}>
        <Text numberOfLines={1} style={[text.meta, { flex: 1 }]}>
          {payment.billingStatementNumber}{payment.serviceReportId ? ` · ${payment.serviceReportNumber ?? 'Draft CSR'}` : ''} · {formatDisplayDate(payment.businessDate)}
        </Text>
        <Text style={[text.amount, payment.state === 'voided' ? styles.strike : null]}>{formatCentavos(payment.amountCentavos)}</Text>
      </View>
      <Text style={text.meta}>{sentenceCase(payment.method)} · PDF {payment.pdfState.replaceAll('_', ' ')}</Text>
    </Pressable>
  );
});

export default function PaymentsScreen() {
  const db = useSQLiteContext();
  const split = useSplitLayout();
  const [rows, setRows] = useState<PaymentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const visibleRows = useMemo(() => filterPaymentsByQuery(rows, query), [rows, query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listPayments(db));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load payments.');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const openPayment = useCallback((paymentId: string) => {
    if (split) setSelectedId(paymentId);
    else router.push({ pathname: '/payments/[payment-id]', params: { 'payment-id': paymentId } });
  }, [split]);

  const list = (
    <FlatList
      data={visibleRows}
      keyboardShouldPersistTaps="handled"
      extraData={`${selectedId}:${split}`}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <PaymentRow payment={item} selected={split && item.id === selectedId} onOpen={openPayment} />}
      refreshing={loading && rows.length > 0}
      onRefresh={load}
      ListHeaderComponent={(
        <View style={styles.header}>
          <ListTitle title="Payments" />
          <ListSearch query={query} onQueryChange={setQuery} placeholder="Search PA, BS or CSR no., customer, reference" />
          <Text style={text.meta}>Payment acknowledgments, newest first. Record a payment from a finalized Billing Statement; corrections keep the original as void.</Text>
          {error ? <Text style={text.error}>{error}</Text> : null}
        </View>
      )}
      ListEmptyComponent={loading
        ? <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 32 }} />
        : rows.length > 0
          ? <ListEmpty title="No matching payments" body={`Nothing matches “${query.trim()}”. Try a PA or BS number.`} />
          : <ListEmpty title="No payments yet" body="Open a finalized statement to record its required payment." />}
    />
  );

  if (!split) return list;

  return (
    <SplitView
      list={list}
      detail={selectedId ? <PaymentDetailView key={selectedId} embedded paymentId={selectedId} /> : null}
      emptyTitle="Select a payment"
      emptyBody="Its acknowledgment details and actions open here."
    />
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm, padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.separator, backgroundColor: colors.surface },
  strike: { color: colors.secondaryLabel, textDecorationLine: 'line-through' },
});
