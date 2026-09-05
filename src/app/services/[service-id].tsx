import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { formatCentavos, parseCurrencyToCentavos } from '@/domain/money';
import {
  getService,
  setServiceActive,
  updateService,
} from '@/features/services/service-repository';
import type { ServiceCatalogEntry } from '@/features/services/service-types';
import { colors } from '@/theme/colors';

export default function ServiceDetailScreen() {
  const { 'service-id': serviceId } = useLocalSearchParams<{ 'service-id': string }>();
  const db = useSQLiteContext();
  const [service, setService] = useState<ServiceCatalogEntry | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadService = useCallback(async () => {
    if (!serviceId) {
      setError('Service identifier is missing.');
      return;
    }
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
    }
  }, [db, serviceId]);

  useEffect(() => {
    void loadService();
  }, [loadService]);

  const save = useCallback(async () => {
    if (!serviceId) return;
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
      setNotice('Changes saved. Existing finalized documents remain unchanged.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not update the service.');
    } finally {
      setSaving(false);
    }
  }, [db, description, loadService, name, rate, serviceId]);

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
              .then(loadService)
              .catch((toggleError: unknown) => {
                setError(toggleError instanceof Error ? toggleError.message : 'Could not update service.');
              });
          },
        },
      ],
    );
  }, [db, loadService, service]);

  return (
    <>
      <Stack.Screen options={{ title: service?.name ?? 'Service' }} />
      <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.summary}>
            <View style={styles.summaryHeader}>
              <Text selectable style={styles.eyebrow}>CURRENT CATALOG RATE</Text>
              {service ? (
                <Text selectable style={service.active ? styles.activeBadge : styles.inactiveBadge}>
                  {service.active ? 'ACTIVE' : 'INACTIVE'}
                </Text>
              ) : null}
            </View>
            <Text selectable style={styles.currentRate}>
              {service ? formatCentavos(service.baseRateCentavos) : 'Loading…'}
            </Text>
            <Text selectable style={styles.summaryText}>
              Rate changes apply to future document finalizations only.
            </Text>
          </View>

          <FormField autoCapitalize="words" label="Service name" onChangeText={setName} value={name} />
          <FormField keyboardType="decimal-pad" label="Default rate" onChangeText={setRate} value={rate} />
          <FormField
            label="Description (optional)"
            multiline
            onChangeText={setDescription}
            style={styles.multiline}
            textAlignVertical="top"
            value={description}
          />

          {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
          {notice ? <Text selectable style={styles.noticeText}>{notice}</Text> : null}

          <View style={styles.actions}>
            <ActionButton disabled={saving || !service} onPress={() => void save()}>
              {saving ? 'Saving…' : 'Save changes'}
            </ActionButton>
            {service ? (
              <ActionButton disabled={saving} onPress={confirmActiveToggle} variant="secondary">
                {service.active ? 'Deactivate service' : 'Reactivate service'}
              </ActionButton>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { gap: 18, padding: 18, paddingBottom: 44 },
  summary: { gap: 6, padding: 17, backgroundColor: '#eaf2ff', borderRadius: 17, borderCurve: 'continuous' },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  eyebrow: { color: colors.brandBlue, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  currentRate: { color: colors.brandNavy, fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
  summaryText: { color: colors.brandNavy, fontSize: 13, lineHeight: 18 },
  activeBadge: { color: colors.success, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  inactiveBadge: { color: colors.secondaryLabel, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  multiline: { minHeight: 104 },
  actions: { gap: 10, paddingTop: 4 },
  errorText: { color: colors.error, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  noticeText: { color: colors.success, fontSize: 13, lineHeight: 19, fontWeight: '700' },
});
