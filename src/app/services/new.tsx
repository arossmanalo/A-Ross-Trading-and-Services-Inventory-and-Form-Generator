import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { Notice } from '@/components/notice';
import { SheetBody } from '@/components/sheet-body';
import { parseCurrencyToCentavos } from '@/domain/money';
import { createService } from '@/features/services/service-repository';

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
    <SheetBody
      error={error}
      actions={
        <>
          <ActionButton disabled={saving} onPress={() => void save()}>
            {saving ? 'Saving…' : 'Save service'}
          </ActionButton>
          <ActionButton disabled={saving} onPress={() => router.back()} variant="secondary">
            Cancel
          </ActionButton>
        </>
      }
    >
      <Notice label="Service catalog">
        Services use quantity one. The rate can still be customized on a future draft.
      </Notice>
      <FormField autoCapitalize="words" label="Service name" onChangeText={setName} placeholder="Labor / service fee" value={name} />
      <FormField keyboardType="decimal-pad" label="Default rate" onChangeText={setRate} placeholder="0.00" value={rate} />
      <FormField
        label="Description (optional)"
        multiline
        onChangeText={setDescription}
        placeholder="What this service covers"
        style={styles.multiline}
        textAlignVertical="top"
        value={description}
      />
    </SheetBody>
  );
}

const styles = StyleSheet.create({
  multiline: { minHeight: 104 },
});
