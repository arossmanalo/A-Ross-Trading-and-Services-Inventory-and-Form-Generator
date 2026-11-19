import * as LocalAuthentication from 'expo-local-authentication';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { EDIT_PIN_LENGTH, hasEditPin, setEditPin, verifyEditPin } from '@/features/settings/edit-pin';
import { spacing, text } from '@/theme/typography';

/** 'set': no PIN yet. 'change': old PIN required. 'reset': the tablet's screen lock was passed instead. */
type Form = 'set' | 'change' | 'reset' | null;

/** Settings for the PIN that guards deleting inventory items and changing quantities. */
export function EditPinSettings() {
  const db = useSQLiteContext();
  const [pinExists, setPinExists] = useState<boolean | null>(null);
  const [form, setForm] = useState<Form>(null);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void hasEditPin(db)
      .then((exists) => {
        setPinExists(exists);
        if (!exists) setForm('set');
      })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not check the PIN.'));
  }, [db]);

  const openForm = useCallback((next: Form) => {
    setForm(next);
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setError(null);
    setNotice(null);
  }, []);

  const resetWithScreenLock = useCallback(async () => {
    setError(null);
    setNotice(null);
    try {
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirm it is you to reset the inventory PIN' });
      if (result.success) openForm('reset');
      else setError('The tablet did not confirm your identity, so the PIN was not reset. The tablet needs a screen lock or fingerprint for this.');
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Could not open the tablet screen lock.');
    }
  }, [openForm]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (form === 'change' && !(await verifyEditPin(db, currentPin))) throw new Error('The current PIN is not correct.');
      if (newPin !== confirmPin) throw new Error('The two new PINs do not match.');
      await setEditPin(db, newPin);
      setPinExists(true);
      openForm(null);
      setNotice('PIN saved. It is needed to delete items and change quantities on hand.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the PIN.');
    } finally {
      setBusy(false);
    }
  }, [confirmPin, currentPin, db, form, newPin, openForm]);

  if (pinExists === null) return error ? <Text style={text.error}>{error}</Text> : null;

  return (
    <View style={styles.container}>
      <Text style={text.body}>
        {pinExists
          ? 'A PIN is set. It is asked for before an inventory item is deleted or its quantity on hand is changed.'
          : 'No PIN is set yet. Set one so only you can delete inventory items or change quantities on hand.'}
      </Text>

      {form ? (
        <View style={styles.form}>
          {form === 'change' ? (
            <FormField keyboardType="number-pad" label="Current PIN" maxLength={EDIT_PIN_LENGTH.max} onChangeText={setCurrentPin} secureTextEntry value={currentPin} />
          ) : null}
          <FormField
            hint={`${EDIT_PIN_LENGTH.min} to ${EDIT_PIN_LENGTH.max} digits`}
            keyboardType="number-pad"
            label="New PIN"
            maxLength={EDIT_PIN_LENGTH.max}
            onChangeText={setNewPin}
            secureTextEntry
            value={newPin}
          />
          <FormField keyboardType="number-pad" label="Type the new PIN again" maxLength={EDIT_PIN_LENGTH.max} onChangeText={setConfirmPin} secureTextEntry value={confirmPin} />
          <View style={styles.actions}>
            <ActionButton compact disabled={busy || newPin.length < EDIT_PIN_LENGTH.min} onPress={() => void save()}>
              {busy ? 'Saving…' : 'Save PIN'}
            </ActionButton>
            {pinExists ? <ActionButton compact disabled={busy} variant="secondary" onPress={() => openForm(null)}>Cancel</ActionButton> : null}
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <ActionButton compact variant="secondary" onPress={() => openForm('change')}>Change PIN</ActionButton>
          <ActionButton compact variant="secondary" onPress={() => void resetWithScreenLock()}>Forgot PIN</ActionButton>
        </View>
      )}

      {error ? <Text accessibilityLiveRegion="polite" style={text.error}>{error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={text.meta}>{notice}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  form: { gap: spacing.md, maxWidth: 420 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
