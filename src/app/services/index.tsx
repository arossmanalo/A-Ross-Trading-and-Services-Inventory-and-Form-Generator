import { Link, Stack, router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatCentavos } from '@/domain/money';
import { listServices } from '@/features/services/service-repository';
import type { ServiceCatalogEntry } from '@/features/services/service-types';
import { colors } from '@/theme/colors';

const ServiceRow = memo(function ServiceRow({ service }: { service: ServiceCatalogEntry }) {
  const openService = useCallback(() => {
    router.push({ pathname: '/services/[service-id]', params: { 'service-id': service.id } });
  }, [service.id]);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={openService}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <View style={styles.rowCopy}>
        <View style={styles.titleLine}>
          <Text selectable numberOfLines={1} style={styles.serviceName}>{service.name}</Text>
          {!service.active ? <Text selectable style={styles.inactiveBadge}>INACTIVE</Text> : null}
        </View>
        <Text selectable numberOfLines={2} style={styles.description}>
          {service.description || 'No description'}
        </Text>
      </View>
      <Text selectable style={styles.rate}>{formatCentavos(service.baseRateCentavos)}</Text>
    </Pressable>
  );
});

export default function ServicesScreen() {
  const db = useSQLiteContext();
  const [services, setServices] = useState<ServiceCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadServices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setServices(await listServices(db));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load services.');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(useCallback(() => {
    void loadServices();
  }, [loadServices]));

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/services/new" asChild>
              <Pressable accessibilityRole="button" hitSlop={10}>
                <Text selectable style={styles.addButton}>Add</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={services.length === 0 ? styles.emptyContent : styles.content}
        data={services}
        keyExtractor={getServiceKey}
        renderItem={renderService}
        ItemSeparatorComponent={RowSeparator}
        refreshing={loading && services.length > 0}
        onRefresh={loadServices}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text selectable style={styles.eyebrow}>SERVICE CATALOG</Text>
            <Text selectable style={styles.headerText}>
              Rates are owner-controlled. Future documents use the current rate; finalized documents keep their snapshot.
            </Text>
            {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.brandBlue} size="large" />
          ) : (
            <View style={styles.emptyState}>
              <Text selectable style={styles.emptyTitle}>No services yet</Text>
              <Text selectable style={styles.emptyBody}>
                Add labor or service offerings with an editable default rate.
              </Text>
            </View>
          )
        }
      />
    </>
  );
}

function getServiceKey(service: ServiceCatalogEntry) {
  return service.id;
}

function renderService({ item }: { item: ServiceCatalogEntry }) {
  return <ServiceRow service={item} />;
}

function RowSeparator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingBottom: 44 },
  emptyContent: { flexGrow: 1, paddingHorizontal: 18, paddingBottom: 44 },
  header: { gap: 5, paddingVertical: 18 },
  eyebrow: { color: colors.brandBlue, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  headerText: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 },
  addButton: { color: colors.brandBlue, fontSize: 16, fontWeight: '800' },
  row: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 13,
  },
  rowCopy: { flex: 1, gap: 5 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  serviceName: { flexShrink: 1, color: colors.label, fontSize: 16, fontWeight: '800' },
  inactiveBadge: { color: colors.secondaryLabel, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  description: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
  rate: { color: colors.brandNavy, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 28 },
  emptyTitle: { color: colors.label, fontSize: 21, fontWeight: '900' },
  emptyBody: { maxWidth: 320, color: colors.secondaryLabel, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  errorText: { color: colors.error, fontSize: 13, lineHeight: 18 },
  pressed: { opacity: 0.72 },
});
