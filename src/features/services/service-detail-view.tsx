import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { RecordHeader } from '@/components/record-layout';
import { StatusChip } from '@/components/status-chip';
import { formatCentavos, parseCurrencyToCentavos } from '@/domain/money';
import { getService, setServiceActive, updateService } from '@/features/services/service-repository';
import type { ServiceCatalogEntry } from '@/features/services/service-types';
import { colors } from '@/theme/colors';
import { spacing, text } from '@/theme/typography';

type ServiceDetailViewProps = {
  serviceId: string;
  embedded?: boolean;
  onChanged?: () => void;
};

export function ServiceDetailView({ serviceId, embedded = false, onChanged }: ServiceDetailViewProps) {
  const db = useSQLiteContext();
  const [service, setService] = useState<ServiceCatalogEntry | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rate, setRate] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadService = useCallback(async () => {
    setError(null);
    try {
      const result = await getService(db, serviceId);
      if (!result) throw new Error('Service was not found.');
      setService(result);
      setName(result.name);
      setDescription(result.description);
      setRate((result.baseRateCentavos / 100).toFixed(2));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the service.');
    } finally {
      setLoaded(true);
    }
  }, [db, serviceId]);

  useEffect(() => {
    void loadService();
  }, [loadService]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await updateService(db, serviceId, {
        name,
        description,
        baseRateCentavos: parseCurrencyToCentavos(rate || '0'),
      });
      await loadService();
      onChanged?.();
      setNotice('Changes saved. Existing finalized documents remain unchanged.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update the service.');
    } finally {
      setSaving(false);
    }
  }, [db, description, loadService, name, onChanged, rate, serviceId]);

  const confirmActiveToggle = useCallback(() => {
    if (!service) return;
    const nextActive = !service.active;
    Alert.alert(
      nextActive ? 'Reactivate service?' : 'Deactivate service?',
      nextActive
        ? 'The service will be available on new drafts.'
        : 'Existing document history remains unchanged.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextActive ? 'Reactivate' : 'Deactivate',
          style: nextActive ? 'default' : 'destructive',
          onPress: () => {
            void setServiceActive(db, service.id, nextActive)
              .then(async () => {
                await loadService();
                onChanged?.();
              })
              .catch((toggleError: unknown) => {
                setError(toggleError instanceof Error ? toggleError.message : 'Could not update service.');
              });
          },
        },
      ],
    );
  }, [db, loadService, onChanged, service]);

  if (!loaded) return <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>;
  if (!service) return <View style={styles.centered}><Text selectable style={text.error}>{error ?? 'Service was not found.'}</Text></View>;

  return (
    <>
      {embedded ? null : <Stack.Screen options={{ title: service.name }} />}
      <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <RecordHeader
            title={service.name}
            chips={<StatusChip label={service.active ? 'Active' : 'Inactive'} tone={service.active ? 'final' : 'neutral'} />}
            subtitle={`Current catalog rate ${formatCentavos(service.baseRateCentavos)} · changes apply to future finalizations only`}
            actions={(
              <ActionButton compact disabled={saving} variant={service.active ? 'danger' : 'secondary'} onPress={confirmActiveToggle}>
                {service.active ? 'Deactivate service' : 'Reactivate service'}
              </ActionButton>
            )}
          />
          <View style={styles.form}>
            <FormField autoCapitalize="words" label="Service name" onChangeText={setName} value={name} />
            <FormField containerStyle={styles.rateField} keyboardType="decimal-pad" label="Default rate" onChangeText={setRate} value={rate} />
            <FormField
              label="Description (optional)"
              multiline
              onChangeText={setDescription}
              style={styles.multiline}
              textAlignVertical="top"
              value={description}
            />
            {error ? <Text accessibilityLiveRegion="polite" selectable style={text.error}>{error}</Text> : null}
            {notice ? <Text accessibilityLiveRegion="polite" selectable style={styles.notice}>{notice}</Text> : null}
            <ActionButton disabled={saving} style={styles.saveButton} onPress={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</ActionButton>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  content: { gap: spacing.lg, padding: spacing.xxl, paddingBottom: 48 },
  form: { gap: spacing.lg, maxWidth: 620 },
  rateField: { maxWidth: 240 },
  multiline: { minHeight: 96 },
  notice: { color: colors.success, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  saveButton: { alignSelf: 'flex-start' },
});
