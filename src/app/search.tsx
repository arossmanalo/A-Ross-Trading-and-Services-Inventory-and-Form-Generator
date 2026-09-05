import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import {
  searchAppRecords,
  searchResultKindLabel,
  type GlobalSearchResult,
} from '@/features/reports/global-search';
import { colors } from '@/theme/colors';

export default function SearchScreen() {
  const db = useSQLiteContext();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async () => {
    setBusy(true);
    setError(null);
    try {
      setResults(await searchAppRecords(db, query));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Search failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 18, gap: 12, paddingBottom: 44 }}
      data={results}
      keyExtractor={item => `${item.kind}:${item.id}`}
      ListHeaderComponent={(
        <View style={{ gap: 14, marginBottom: 16 }}>
          <Text selectable>Search customers, equipment, inventory items, services, CSRs, billing statements, and payments.</Text>
          <FormField label="Search records" value={query} onChangeText={setQuery} editable={!busy} />
          <ActionButton disabled={busy} onPress={() => void runSearch()}>{busy ? 'Searching...' : 'Search'}</ActionButton>
          <Text selectable>{results.length} matching records</Text>
          {error ? <Text selectable style={{ color: colors.error }}>{error}</Text> : null}
        </View>
      )}
      ListEmptyComponent={<Text selectable>{query.trim() ? 'No matching records.' : 'Enter a name, number, SKU, date, serial number, or reference.'}</Text>}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => openResult(item)}
          style={{ padding: 16, gap: 6, borderRadius: 12, backgroundColor: colors.surface }}
        >
          <Text selectable style={{ color: colors.secondaryLabel, fontSize: 12, fontWeight: '800' }}>
            {searchResultKindLabel(item.kind)}
          </Text>
          <Text selectable style={{ color: colors.label, fontSize: 16, fontWeight: '800' }}>{item.title}</Text>
          {item.subtitle ? <Text selectable style={{ color: colors.secondaryLabel }}>{item.subtitle}</Text> : null}
          <Text selectable style={{ color: colors.secondaryLabel }}>{item.detail}</Text>
        </Pressable>
      )}
    />
  );
}

function openResult(result: GlobalSearchResult) {
  if (result.kind === 'customer' || result.kind === 'equipment') {
    router.push({ pathname: '/customers/[customer-id]', params: { 'customer-id': result.routeId } });
  } else if (result.kind === 'item') {
    router.push({ pathname: '/inventory/item/[item-id]', params: { 'item-id': result.routeId } });
  } else if (result.kind === 'service') {
    router.push({ pathname: '/services/[service-id]', params: { 'service-id': result.routeId } });
  } else if (result.kind === 'service_report') {
    router.push({ pathname: '/service-reports/[report-id]', params: { 'report-id': result.routeId } });
  } else if (result.kind === 'billing_statement') {
    router.push({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': result.routeId } });
  } else {
    router.push({ pathname: '/payments/[payment-id]', params: { 'payment-id': result.routeId } });
  }
}
