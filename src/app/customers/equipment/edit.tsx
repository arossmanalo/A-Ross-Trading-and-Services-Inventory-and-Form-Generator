import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { getCustomerDetail, updateEquipment } from '@/features/customers/customer-repository';
import { colors } from '@/theme/colors';

export default function EditEquipmentScreen() {
  const { customerId, equipmentId } = useLocalSearchParams<{ customerId: string; equipmentId: string }>();
  const db = useSQLiteContext();
  const [machineType, setMachineType] = useState('');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [nicknameOrLocation, setNicknameOrLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    if (!customerId || !equipmentId) return undefined;
    void getCustomerDetail(db, customerId).then((customer) => {
      if (!active) return;
      const equipment = customer?.equipment.find((entry) => entry.id === equipmentId);
      if (!equipment) { setError('Equipment was not found.'); return; }
      setMachineType(equipment.machineType);
      setModel(equipment.model);
      setSerialNumber(equipment.serialNumber);
      setNicknameOrLocation(equipment.nicknameOrLocation);
      setNotes(equipment.notes);
      setLoaded(true);
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load the equipment.');
    });
    return () => { active = false; };
  }, [customerId, db, equipmentId]);

  const save = useCallback(async () => {
    if (!equipmentId) return;
    setSaving(true);
    setError(null);
    try {
      await updateEquipment(db, { equipmentId, machineType, model, serialNumber, nicknameOrLocation, notes });
      router.back();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the equipment.');
    } finally {
      setSaving(false);
    }
  }, [db, equipmentId, machineType, model, nicknameOrLocation, notes, serialNumber]);

  return (
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <Text selectable style={styles.eyebrow}>EDIT EQUIPMENT</Text>
          <Text selectable style={styles.introText}>
            Changes apply to new documents. Finalized documents keep the details they were issued with.
          </Text>
        </View>
        <FormField autoCapitalize="words" label="Machine or equipment type" onChangeText={setMachineType} placeholder="Industrial washing machine" value={machineType} />
        <FormField label="Model (optional)" onChangeText={setModel} placeholder="Model name or number" value={model} />
        <FormField autoCapitalize="characters" label="Serial number (optional)" onChangeText={setSerialNumber} placeholder="Recorded exactly as shown" value={serialNumber} />
        <FormField autoCapitalize="words" label="Nickname or location (optional)" onChangeText={setNicknameOrLocation} placeholder="Laundry area · Unit 2" value={nicknameOrLocation} />
        <FormField label="Notes (optional)" multiline onChangeText={setNotes} placeholder="Access details, specifications, or service notes" style={styles.multiline} textAlignVertical="top" value={notes} />
        {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
        <View style={styles.actions}>
          <ActionButton disabled={saving || !loaded} onPress={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</ActionButton>
          <ActionButton disabled={saving} onPress={() => router.back()} variant="secondary">Cancel</ActionButton>
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
