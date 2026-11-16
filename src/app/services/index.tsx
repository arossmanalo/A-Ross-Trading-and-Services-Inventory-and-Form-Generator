import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ListEmpty, listRowStyles, ListTitle } from '@/components/list-pane';
import { SplitView, useSplitLayout } from '@/components/split-view';
import { StatusChip } from '@/components/status-chip';
import { formatCentavos } from '@/domain/money';
import { ServiceDetailView } from '@/features/services/service-detail-view';
import { listServices } from '@/features/services/service-repository';
import type { ServiceCatalogEntry } from '@/features/services/service-types';
import { colors } from '@/theme/colors';
import { spacing, text } from '@/theme/typography';

type ServiceRowProps = { service: ServiceCatalogEntry; selected: boolean; onOpen: (serviceId: string) => void };

const ServiceRow = memo(function ServiceRow({ service, selected, onOpen }: ServiceRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onOpen(service.id)}
      style={({ pressed }) => [listRowStyles.row, styles.row, selected ? listRowStyles.selected : null, pressed && !selected ? listRowStyles.pressed : null]}
    >
      <View style={styles.copy}>
        <View style={listRowStyles.titleLine}>
          <Text numberOfLines={1} style={[text.bodyStrong, styles.copy]}>{service.name}</Text>
          {!service.active ? <StatusChip label="Inactive" tone="neutral" /> : null}
        </View>
        <Text numberOfLines={2} style={text.meta}>{service.description || 'No description'}</Text>
      </View>
      <Text style={text.amount}>{formatCentavos(service.baseRateCentavos)}</Text>
    </Pressable>
  );
});

export default function ServicesScreen() {
  const db = useSQLiteContext();
  const split = useSplitLayout();
  const [services, setServices] = useState<ServiceCatalogEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  useFocusEffect(useCallback(() => { void loadServices(); }, [loadServices]));

  const openService = useCallback((serviceId: string) => {
    if (split) setSelectedId(serviceId);
    else router.push({ pathname: '/services/[service-id]', params: { 'service-id': serviceId } });
  }, [split]);

  const list = (
    <FlatList
      data={services}
      extraData={`${selectedId}:${split}`}
      keyExtractor={(service) => service.id}
      renderItem={({ item }) => <ServiceRow service={item} selected={split && item.id === selectedId} onOpen={openService} />}
      refreshing={loading && services.length > 0}
      onRefresh={loadServices}
      ListHeaderComponent={(
        <View style={styles.header}>
          <ListTitle title="Service catalog" actionLabel="Add service" onAction={() => router.push('/services/new')} />
          <Text style={text.meta}>Labor and service rates. The rate can be changed per machine on each CSR.</Text>
          {error ? <Text style={text.error}>{error}</Text> : null}
        </View>
      )}
      ListEmptyComponent={loading
        ? <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 32 }} />
        : <ListEmpty title="No services yet" body="Add the labor and service fees you charge, with a default rate for each." />}
    />
  );

  if (!split) return list;

  return (
    <SplitView
      list={list}
      listWidth={360}
      detail={selectedId ? (
        <ServiceDetailView key={selectedId} embedded serviceId={selectedId} onChanged={() => void loadServices()} />
      ) : null}
      emptyTitle="Select a service"
      emptyBody="Its name, default rate and description open here for editing."
    />
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.separator, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  copy: { flex: 1, minWidth: 0 },
});
