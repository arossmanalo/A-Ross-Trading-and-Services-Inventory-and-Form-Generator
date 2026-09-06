import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { parseCurrencyToCentavos } from '@/domain/money';
import { createService } from '@/features/services/service-repository';
import { colors } from '@/theme/colors';

export default function NewServiceScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const db = useSQLiteContext();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const serviceId = await createService(db, {
        name,
        description,
        baseRateCentavos: parseCurrencyToCentavos(rate || '0'),
      });
      if (returnTo === 'service-report-service-usage') router.back();
      else router.replace({ pathname: '/services/[service-id]', params: { 'service-id': serviceId } });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the service.');
    } finally {
      setSaving(false);
    }
  }, [db, description, name, rate, returnTo]);

  return (
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.intro}>
          <Text selectable style={styles.eyebrow}>SERVICE CATALOG</Text>
          <Text selectable style={styles.introText}>
            Services use quantity one. The rate can still be customized on a future draft.
          </Text>
        </View>
        <FormField
          autoCapitalize="words"
          label="Service name"
          onChangeText={setName}
          placeholder="Labor / service fee"
          value={name}
        />
        <FormField
          keyboardType="decimal-pad"
          label="Default rate"
          onChangeText={setRate}
          placeholder="0.00"
          value={rate}
        />
        <FormField
          label="Description (optional)"
          multiline
          onChangeText={setDescription}
          placeholder="What this service covers"
          style={styles.multiline}
          textAlignVertical="top"
          value={description}
        />
        {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
        <View style={styles.actions}>
          <ActionButton disabled={saving} onPress={() => void save()}>
            {saving ? 'Saving…' : 'Save service'}
          </ActionButton>
          <ActionButton disabled={saving} onPress={() => router.back()} variant="secondary">
            Cancel
          </ActionButton>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { gap: 18, padding: 18, paddingBottom: 44 },
  intro: { gap: 6, padding: 16, backgroundColor: '#eaf2ff', borderRadius: 16, borderCurve: 'continuous' },
  eyebrow: { color: colors.brandBlue, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  introText: { color: colors.brandNavy, fontSize: 14, lineHeight: 20 },
  multiline: { minHeight: 104 },
  actions: { gap: 10, paddingTop: 4 },
  errorText: { color: colors.error, fontSize: 14, lineHeight: 20, fontWeight: '600' },
});
