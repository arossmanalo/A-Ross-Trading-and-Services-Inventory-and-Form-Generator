import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import {
  searchAppRecords,
  searchResultKindLabel,
  type GlobalSearchResult,
} from '@/features/reports/global-search';
import { colors } from '@/theme/colors';
import { fontSize, radius, spacing, text } from '@/theme/typography';

export default function SearchScreen() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ q?: string }>();
  const initialQuery = typeof params.q === 'string' ? params.q : '';
  const [query, setQuery] = useState(initialQuery);
  const [searched, setSearched] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestSearch = useRef(0);

  const runSearch = useCallback(async (value: string) => {
    const searchId = latestSearch.current + 1;
    latestSearch.current = searchId;
    setBusy(true);
    setError(null);
    try {
      const found = await searchAppRecords(db, value);
      if (latestSearch.current !== searchId) return;
      setResults(found);
      setSearched(value.trim());
    } catch (caught) {
      if (latestSearch.current === searchId) setError(caught instanceof Error ? caught.message : 'Search failed. Try again.');
    } finally {
      if (latestSearch.current === searchId) setBusy(false);
    }
  }, [db]);

  useEffect(() => {
    if (initialQuery.trim()) void runSearch(initialQuery);
  }, [initialQuery, runSearch]);

  const sections = useMemo(() => {
    const groups = new Map<string, GlobalSearchResult[]>();
    for (const result of results) {
      const label = searchResultKindLabel(result.kind);
      groups.set(label, [...(groups.get(label) ?? []), result]);
    }
    return [...groups.entries()].map(([title, data]) => ({ title, data }));
  }, [results]);

  return (
    <SectionList
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      sections={sections}
      keyExtractor={(item) => `${item.kind}:${item.id}`}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={(
        <View style={styles.header}>
          <View style={styles.searchRow}>
            <TextInput
              accessibilityLabel="Search records"
              autoFocus={!initialQuery}
              editable={!busy}
              onChangeText={setQuery}
              onSubmitEditing={() => void runSearch(query)}
              placeholder="Name, number, SKU, date, serial number, or reference"
              placeholderTextColor={colors.secondaryLabel}
              returnKeyType="search"
              style={styles.input}
              value={query}
            />
            <ActionButton disabled={busy} onPress={() => void runSearch(query)}>{busy ? 'Searching…' : 'Search'}</ActionButton>
          </View>
          <Text style={text.meta}>
            Searches customers, equipment, inventory items, services, CSRs, quotations, deliveries, billing statements and payments.
          </Text>
          {searched ? <Text style={text.meta}>{results.length} matching record{results.length === 1 ? '' : 's'} for “{searched}”</Text> : null}
          {error ? <Text style={text.error}>{error}</Text> : null}
        </View>
      )}
      ListEmptyComponent={(
        <Text style={[text.body, styles.empty]}>
          {searched ? 'No matching records.' : 'Enter a name, number, SKU, date, serial number, or reference.'}
        </Text>
      )}
      renderSectionHeader={({ section }) => <Text style={[text.label, styles.sectionTitle]}>{section.title.toUpperCase()}</Text>}
      renderItem={({ item, index, section }) => (
        <Pressable
          accessibilityRole="link"
          onPress={() => openResult(item)}
          style={({ pressed }) => [
            styles.row,
            index === 0 ? styles.firstRow : null,
            index === section.data.length - 1 ? styles.lastRow : null,
            pressed ? styles.pressed : null,
          ]}
        >
          <View style={styles.rowCopy}>
            <Text style={text.bodyStrong}>{item.title}</Text>
            {item.subtitle ? <Text style={text.meta}>{item.subtitle}</Text> : null}
            <Text style={text.meta}>{item.detail}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
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
  } else if (result.kind === 'delivery') {
    router.push({ pathname: '/deliveries/[delivery-id]', params: { 'delivery-id': result.routeId } });
  } else if (result.kind === 'quotation') {
    router.push({ pathname: '/quotations/[quotation-id]', params: { 'quotation-id': result.routeId } });
  } else if (result.kind === 'billing_statement') {
    router.push({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': result.routeId } });
  } else {
    router.push({ pathname: '/payments/[payment-id]', params: { 'payment-id': result.routeId } });
  }
}

const styles = StyleSheet.create({
  content: { padding: spacing.xxl, paddingBottom: 48, maxWidth: 900, width: '100%' },
  header: { gap: spacing.sm, marginBottom: spacing.lg },
  searchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'center' },
  input: {
    flexGrow: 1,
    flexBasis: 280,
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    color: colors.label,
    fontSize: fontSize.subhead,
  },
  empty: { color: colors.secondaryLabel },
  sectionTitle: { marginTop: spacing.lg, marginBottom: 6, letterSpacing: 0.6, color: colors.secondaryLabel },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: colors.separator,
  },
  firstRow: { borderTopWidth: 1, borderTopLeftRadius: radius.panel, borderTopRightRadius: radius.panel },
  lastRow: { borderBottomLeftRadius: radius.panel, borderBottomRightRadius: radius.panel },
  rowCopy: { flex: 1, gap: 2 },
  chevron: { color: colors.secondaryLabel, fontSize: fontSize.section },
  pressed: { backgroundColor: colors.subtleSurface },
});
