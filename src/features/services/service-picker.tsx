import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { formatCentavos, parseCurrencyToCentavos } from '@/domain/money';
import { filterServicesForSelection } from '@/domain/service-search';
import { createService } from '@/features/services/service-repository';
import type { ServiceCatalogEntry } from '@/features/services/service-types';
import { colors } from '@/theme/colors';

/** Results beyond this are hidden so a large catalog never floods the screen. */
const MAX_VISIBLE_RESULTS = 100;

type ServicePickerProps = {
  services: ServiceCatalogEntry[];
  /** Tapping a service reports it; the parent decides what to do with it. */
  onSelect: (service: ServiceCatalogEntry) => void;
  /** Called after quick add with the new service id. The parent should reload its list. */
  onCreated: (serviceId: string) => Promise<void> | void;
  /** Shown above the search box, for example "Adding to Washer #1". */
  heading?: string;
  disabled?: boolean;
};

export function ServicePicker({ services, onSelect, onCreated, heading, disabled = false }: ServicePickerProps) {
  const db = useSQLiteContext();
  const [query, setQuery] = useState('');
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const matches = useMemo(() => filterServicesForSelection(services, query), [services, query]);
  const visible = matches.slice(0, MAX_VISIBLE_RESULTS);

  const openQuickAdd = useCallback(() => {
    setName(query.trim());
    setError(null);
    setQuickAddOpen(true);
  }, [query]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const serviceId = await createService(db, { name, baseRateCentavos: parseCurrencyToCentavos(rate || '0') });
      setQuery('');
      setName('');
      setRate('');
      setQuickAddOpen(false);
      await onCreated(serviceId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the service.');
    } finally {
      setSaving(false);
    }
  }, [db, name, onCreated, rate]);

  return (
    <View style={styles.container}>
      {heading ? <Text selectable style={styles.heading}>{heading}</Text> : null}
      <FormField
        autoCapitalize="none"
        autoCorrect={false}
        label="Search services"
        onChangeText={setQuery}
        placeholder="Service name or description"
        returnKeyType="search"
        value={query}
      />
      <Text selectable style={styles.count}>
        {matches.length === 0
          ? 'No matching services'
          : matches.length > MAX_VISIBLE_RESULTS
            ? `Showing the first ${MAX_VISIBLE_RESULTS} of ${matches.length} services. Type more to narrow the list.`
            : `${matches.length} service${matches.length === 1 ? '' : 's'}`}
      </Text>

      {matches.length > 0 ? (
        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.list} testID="service-picker-list">
          {visible.map((service, index) => (
            <Pressable
              key={service.id}
              accessibilityRole="button"
              accessibilityLabel={`Select ${service.name}`}
              disabled={disabled}
              onPress={() => onSelect(service)}
              style={({ pressed }) => [styles.row, index > 0 ? styles.rowDivider : null, pressed ? styles.pressed : null, disabled ? styles.disabled : null]}
            >
              <Text numberOfLines={1} style={styles.rowName}>{service.name}</Text>
              <Text numberOfLines={1} style={styles.rowMeta}>
                {service.baseRateCentavos > 0 ? formatCentavos(service.baseRateCentavos) : 'Price entered each time'}
                {service.description ? ` · ${service.description}` : ''}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {quickAddOpen ? (
        <View style={styles.quickAdd}>
          <Text selectable style={styles.quickAddTitle}>Quick add service</Text>
          <FormField autoCapitalize="words" label="Service name" onChangeText={setName} placeholder="Labor / service fee" value={name} />
          <FormField
            hint="Leave 0 for services that are priced on each job."
            keyboardType="decimal-pad"
            label="Default rate"
            onChangeText={setRate}
            placeholder="0.00"
            value={rate}
          />
          {error ? <Text selectable style={styles.error}>{error}</Text> : null}
          <ActionButton disabled={saving || !name.trim()} onPress={() => void save()}>{saving ? 'Saving…' : 'Save service'}</ActionButton>
          <ActionButton disabled={saving} variant="secondary" onPress={() => setQuickAddOpen(false)}>Cancel</ActionButton>
        </View>
      ) : (
        <ActionButton variant="secondary" onPress={openQuickAdd}>
          {query.trim() && matches.length === 0 ? `Add “${query.trim()}” as a new service` : 'Quick add a new service'}
        </ActionButton>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  heading: { color: colors.brandNavy, fontSize: 15, fontWeight: '800' },
  count: { color: colors.secondaryLabel, fontSize: 12 },
  list: {
    maxHeight: 280,
    borderWidth: 1,
    borderColor: colors.separator,
    borderCurve: 'continuous',
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  row: { minHeight: 56, justifyContent: 'center', gap: 2, paddingHorizontal: 14, paddingVertical: 10 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowName: { color: colors.label, fontSize: 15, fontWeight: '700' },
  rowMeta: { color: colors.secondaryLabel, fontSize: 12 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
  quickAdd: {
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.brandBlue,
    borderCurve: 'continuous',
    borderRadius: 14,
    backgroundColor: '#eaf2ff',
  },
  quickAddTitle: { color: colors.brandNavy, fontSize: 15, fontWeight: '800' },
  error: { color: colors.error, fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
