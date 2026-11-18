import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ListEmpty, listRowStyles, ListSearch, ListTitle } from '@/components/list-pane';
import { SplitView, useSplitLayout } from '@/components/split-view';
import { StatusChip } from '@/components/status-chip';
import { filterCustomersByQuery } from '@/domain/customer';
import { CustomerDetailView } from '@/features/customers/customer-detail-view';
import { listCustomers } from '@/features/customers/customer-repository';
import type { CustomerSummary } from '@/features/customers/customer-types';
import { colors } from '@/theme/colors';
import { spacing, text } from '@/theme/typography';

type CustomerRowProps = { customer: CustomerSummary; selected: boolean; onOpen: (customerId: string) => void };

const CustomerRow = memo(function CustomerRow({ customer, selected, onOpen }: CustomerRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onOpen(customer.id)}
      style={({ pressed }) => [listRowStyles.row, selected ? listRowStyles.selected : null, pressed && !selected ? listRowStyles.pressed : null]}
    >
      <View style={listRowStyles.titleLine}>
        <Text numberOfLines={1} style={[text.bodyStrong, styles.name]}>{customer.name}</Text>
        {!customer.active ? <StatusChip label="Inactive" tone="neutral" /> : null}
      </View>
      <View style={listRowStyles.metaLine}>
        <Text numberOfLines={1} style={[text.meta, styles.name]}>
          {customer.address || customer.email || customer.contactNumber || 'No contact details yet'}
        </Text>
        <Text style={text.meta}>{customer.equipmentCount} machine{customer.equipmentCount === 1 ? '' : 's'}</Text>
      </View>
    </Pressable>
  );
});

export default function CustomersScreen() {
  const db = useSQLiteContext();
  const split = useSplitLayout();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const visibleCustomers = useMemo(() => filterCustomersByQuery(customers, query), [customers, query]);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCustomers(await listCustomers(db));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load customers.');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(useCallback(() => { void loadCustomers(); }, [loadCustomers]));

  const openCustomer = useCallback((customerId: string) => {
    if (split) setSelectedId(customerId);
    else router.push({ pathname: '/customers/[customer-id]', params: { 'customer-id': customerId } });
  }, [split]);

  const list = (
    <FlatList
      data={visibleCustomers}
      keyboardShouldPersistTaps="handled"
      extraData={`${selectedId}:${split}`}
      keyExtractor={(customer) => customer.id}
      renderItem={({ item }) => <CustomerRow customer={item} selected={split && item.id === selectedId} onOpen={openCustomer} />}
      refreshing={loading && customers.length > 0}
      onRefresh={loadCustomers}
      ListHeaderComponent={(
        <View style={styles.header}>
          <ListTitle
            title="Customers"
            subtitle={`${customers.length} registered`}
            actionLabel="Add customer"
            onAction={() => router.push('/customers/new')}
          />
          <ListSearch query={query} onQueryChange={setQuery} placeholder="Search name, address, phone or email" />
          <Text style={text.meta}>Every service report and billing statement starts from a customer profile.</Text>
          {error ? <Text style={text.error}>{error}</Text> : null}
        </View>
      )}
      ListEmptyComponent={loading
        ? <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 32 }} />
        : customers.length > 0
          ? <ListEmpty title="No matching customers" body={`Nothing matches “${query.trim()}”. Try part of the name or phone number.`} />
          : <ListEmpty title="No customers yet" body="Add the first customer before creating equipment or service work." />}
    />
  );

  if (!split) return list;

  return (
    <SplitView
      list={list}
      listWidth={340}
      detail={selectedId ? (
        <CustomerDetailView key={selectedId} embedded customerId={selectedId} onChanged={() => void loadCustomers()} />
      ) : null}
      emptyTitle="Select a customer"
      emptyBody="Their contact details, equipment, members and prices open here."
    />
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.separator, backgroundColor: colors.surface },
  name: { flex: 1 },
});
