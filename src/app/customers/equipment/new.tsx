import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { Notice } from '@/components/notice';
import { SheetBody, SheetSection } from '@/components/sheet-body';
import { createEquipment } from '@/features/customers/customer-repository';

export default function NewEquipmentScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const db = useSQLiteContext();
  const [machineType, setMachineType] = useState('');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [nicknameOrLocation, setNicknameOrLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    if (!customerId) {
      setError('Customer identifier is missing.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createEquipment(db, {
        customerId,
        machineType,
        model,
        serialNumber,
        nicknameOrLocation,
        notes,
      });
      router.back();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the equipment.');
    } finally {
      setSaving(false);
    }
  }, [customerId, db, machineType, model, nicknameOrLocation, notes, serialNumber]);

  return (
    <SheetBody
      error={error}
      actions={
        <>
          <ActionButton disabled={saving} onPress={() => void save()}>
            {saving ? 'Saving…' : 'Save equipment'}
          </ActionButton>
          <ActionButton disabled={saving} onPress={() => router.back()} variant="secondary">
            Cancel
          </ActionButton>
        </>
      }
    >
      <Notice label="Customer equipment">
        Serial number is free-form and duplicates are allowed by design.
      </Notice>
      <SheetSection title="Machine">
        <FormField
          autoCapitalize="words"
          label="Machine or equipment type"
          onChangeText={setMachineType}
          placeholder="Industrial washing machine"
          value={machineType}
        />
        <FormField label="Model (optional)" onChangeText={setModel} placeholder="Model name or number" value={model} />
        <FormField
          autoCapitalize="characters"
          label="Serial number (optional)"
          onChangeText={setSerialNumber}
          placeholder="Recorded exactly as shown"
          value={serialNumber}
        />
        <FormField
          autoCapitalize="words"
          label="Nickname or location (optional)"
          onChangeText={setNicknameOrLocation}
          placeholder="Laundry area · Unit 2"
          value={nicknameOrLocation}
        />
      </SheetSection>
      <FormField
        label="Notes (optional)"
        multiline
        onChangeText={setNotes}
        placeholder="Access details, specifications, or service notes"
        style={styles.multiline}
        textAlignVertical="top"
        value={notes}
      />
    </SheetBody>
  );
}

const styles = StyleSheet.create({
  multiline: { minHeight: 104 },
});
