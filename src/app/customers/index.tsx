import { Link, Stack, router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';

import { listCustomers } from '@/features/customers/customer-repository';
import type { CustomerSummary } from '@/features/customers/customer-types';
import { colors } from '@/theme/colors';

const CustomerRow = memo(function CustomerRow({ customer }: { customer: CustomerSummary }) {
  const openCustomer = useCallback(() => {
    router.push({
      pathname: '/customers/[customer-id]',
      params: { 'customer-id': customer.id },
    });
  }, [customer.id]);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={openCustomer}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <View style={styles.rowMain}>
        <View style={styles.titleLine}>
          <Text selectable numberOfLines={1} style={styles.customerName}>{customer.name}</Text>
          {!customer.active ? <Text selectable style={styles.inactiveBadge}>INACTIVE</Text> : null}
        </View>
        <Text selectable numberOfLines={2} style={styles.customerMeta}>
          {customer.address || customer.email || customer.contactNumber || 'No contact details yet'}
        </Text>
      </View>
      <View style={styles.countPill}>
        <Text selectable style={styles.countValue}>{customer.equipmentCount}</Text>
        <Text selectable style={styles.countLabel}>machines</Text>
      </View>
    </Pressable>
  );
});

export default function CustomersScreen() {
  useColorScheme();
  const db = useSQLiteContext();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useFocusEffect(
    useCallback(() => {
      void loadCustomers();
    }, [loadCustomers]),
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/customers/new" asChild>
              <Pressable accessibilityRole="button" hitSlop={10}>
                <Text selectable style={styles.addButton}>Add</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={customers.length === 0 ? styles.emptyContent : styles.content}
        data={customers}
        keyExtractor={getCustomerKey}
        renderItem={renderCustomer}
        ItemSeparatorComponent={RowSeparator}
        refreshing={loading && customers.length > 0}
        onRefresh={loadCustomers}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text selectable style={styles.headerEyebrow}>REGISTERED CUSTOMERS</Text>
            <Text selectable style={styles.headerText}>
              Every service report and billing statement starts from a customer profile.
            </Text>
            {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.brandBlue} size="large" />
          ) : (
            <View style={styles.emptyState}>
              <Text selectable style={styles.emptyTitle}>No customers yet</Text>
              <Text selectable style={styles.emptyBody}>
                Add the first customer before creating equipment or service work.
              </Text>
              <Link href="/customers/new" asChild>
                <Pressable accessibilityRole="button" style={styles.emptyAction}>
                  <Text selectable style={styles.emptyActionText}>Add first customer</Text>
                </Pressable>
              </Link>
            </View>
          )
        }
      />
    </>
  );
}

function getCustomerKey(customer: CustomerSummary) {
  return customer.id;
}

function renderCustomer({ item }: { item: CustomerSummary }) {
  return <CustomerRow customer={item} />;
}

function RowSeparator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 18,
    paddingBottom: 44,
  },
  emptyContent: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingBottom: 44,
  },
  header: {
    gap: 5,
    paddingVertical: 18,
  },
  headerEyebrow: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  headerText: {
    color: colors.secondaryLabel,
    fontSize: 14,
    lineHeight: 20,
  },
  addButton: {
    color: colors.brandBlue,
    fontSize: 16,
    fontWeight: '800',
  },
  row: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 13,
  },
  rowMain: {
    flex: 1,
    gap: 5,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  customerName: {
    flexShrink: 1,
    color: colors.label,
    fontSize: 16,
    fontWeight: '800',
  },
  customerMeta: {
    color: colors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
  },
  inactiveBadge: {
    color: colors.secondaryLabel,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  countPill: {
    minWidth: 67,
    alignItems: 'center',
    gap: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#e8f2ff',
    borderRadius: 14,
    borderCurve: 'continuous',
  },
  countValue: {
    color: colors.brandNavy,
    fontSize: 17,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  countLabel: {
    color: colors.brandNavy,
    fontSize: 9,
    fontWeight: '700',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 28,
  },
  emptyTitle: {
    color: colors.label,
    fontSize: 21,
    fontWeight: '900',
  },
  emptyBody: {
    maxWidth: 320,
    color: colors.secondaryLabel,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  emptyAction: {
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 20,
    backgroundColor: colors.brandBlue,
    borderRadius: 14,
    borderCurve: 'continuous',
  },
  emptyActionText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.72,
  },
});
