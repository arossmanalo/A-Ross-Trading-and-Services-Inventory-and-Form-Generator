import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { formatCentavos } from '@/domain/money';
import { getCustomerDetail } from '@/features/customers/customer-repository';
import { listActiveCustomerPrices } from '@/features/pricing/pricing-repository';
import type { CustomerItemPriceSummary } from '@/features/pricing/pricing-types';
import { colors } from '@/theme/colors';

const PriceRow = memo(function PriceRow({ price }: { price: CustomerItemPriceSummary }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowCopy}>
        <Text selectable style={styles.itemName}>{price.itemName}</Text>
        <Text selectable style={styles.itemMeta}>{price.sku || 'No SKU'}</Text>
      </View>
      <Text selectable style={styles.price}>{formatCentavos(price.sellingPriceCentavos)}</Text>
    </View>
  );
});

export default function CustomerPricingScreen() {
  const { 'customer-id': customerId } = useLocalSearchParams<{ 'customer-id': string }>();
  const db = useSQLiteContext();
  const [customerName, setCustomerName] = useState('Customer');
  const [prices, setPrices] = useState<CustomerItemPriceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPrices = useCallback(async () => {
    if (!customerId) {
      setError('Customer identifier is missing.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [customer, rows] = await Promise.all([
        getCustomerDetail(db, customerId),
        listActiveCustomerPrices(db, customerId),
      ]);
      if (!customer) throw new Error('Customer was not found.');
      setCustomerName(customer.name);
      setPrices(rows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load customer prices.');
    } finally {
      setLoading(false);
    }
  }, [customerId, db]);

  useFocusEffect(useCallback(() => {
    void loadPrices();
  }, [loadPrices]));

  const addPrice = useCallback(() => {
    if (!customerId) return;
    router.push({ pathname: '/customers/pricing/new', params: { customerId } });
  }, [customerId]);

  return (
    <>
      <Stack.Screen options={{ title: `${customerName} prices` }} />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={prices.length === 0 ? styles.emptyContent : styles.content}
        data={prices}
        keyExtractor={getPriceKey}
        renderItem={renderPrice}
        ItemSeparatorComponent={RowSeparator}
        refreshing={loading && prices.length > 0}
        onRefresh={loadPrices}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text selectable style={styles.eyebrow}>CUSTOMER-SPECIFIC PRICING</Text>
            <Text selectable style={styles.headerText}>
              These prices override base item prices on future document finalizations.
            </Text>
            <ActionButton onPress={addPrice}>Set item price</ActionButton>
            {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.brandBlue} size="large" />
          ) : (
            <View style={styles.emptyState}>
              <Text selectable style={styles.emptyTitle}>No special prices</Text>
              <Text selectable style={styles.emptyBody}>Base inventory prices apply to this customer.</Text>
            </View>
          )
        }
      />
    </>
  );
}

function getPriceKey(price: CustomerItemPriceSummary) {
  return price.id;
}

function renderPrice({ item }: { item: CustomerItemPriceSummary }) {
  return <PriceRow price={item} />;
}

function RowSeparator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingBottom: 44 },
  emptyContent: { flexGrow: 1, paddingHorizontal: 18, paddingBottom: 44 },
  header: { gap: 12, paddingVertical: 18 },
  eyebrow: { color: colors.brandBlue, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  headerText: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 },
  row: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  rowCopy: { flex: 1, gap: 4 },
  itemName: { color: colors.label, fontSize: 15, fontWeight: '800' },
  itemMeta: { color: colors.secondaryLabel, fontSize: 12 },
  price: { color: colors.brandNavy, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 28 },
  emptyTitle: { color: colors.label, fontSize: 19, fontWeight: '900' },
  emptyBody: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  errorText: { color: colors.error, fontSize: 13, lineHeight: 18 },
});
