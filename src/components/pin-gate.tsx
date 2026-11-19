import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { EDIT_PIN_LENGTH, hasEditPin, setEditPin, verifyEditPin } from '@/features/settings/edit-pin';
import { colors } from '@/theme/colors';
import { radius, spacing, text } from '@/theme/typography';

type Mode = 'enter' | 'create';

/**
 * Guards an action behind the inventory PIN. When no PIN exists yet, the
 * prompt asks the owner to create one first, then carries on with the action.
 */
export function usePinGate(): { requirePin: (purpose: string, action: () => void) => void; pinPrompt: ReactNode } {
  const db = useSQLiteContext();
  const [mode, setMode] = useState<Mode | null>(null);
  const [purpose, setPurpose] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<(() => void) | null>(null);

  const close = useCallback(() => {
    setMode(null);
    setPin('');
    setConfirmPin('');
    setError(null);
    pending.current = null;
  }, []);

  const requirePin = useCallback((nextPurpose: string, action: () => void) => {
    pending.current = action;
    setPurpose(nextPurpose);
    setPin('');
    setConfirmPin('');
    setError(null);
    void hasEditPin(db)
      .then((exists) => setMode(exists ? 'enter' : 'create'))
      .catch((loadError: unknown) => {
        pending.current = null;
        setError(loadError instanceof Error ? loadError.message : 'Could not check the PIN.');
        setMode('enter');
      });
  }, [db]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'create') {
        if (pin !== confirmPin) throw new Error('The two PINs do not match.');
        await setEditPin(db, pin);
      } else if (!(await verifyEditPin(db, pin))) {
        throw new Error('That PIN is not correct.');
      }
      const action = pending.current;
      close();
      action?.();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not check the PIN.');
      setPin('');
      setConfirmPin('');
    } finally {
      setBusy(false);
    }
  }, [close, confirmPin, db, mode, pin]);

  const creating = mode === 'create';
  const pinPrompt = (
    <Modal visible={mode !== null} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
        <Pressable accessibilityLabel="Cancel" style={StyleSheet.absoluteFill} onPress={close} />
        <View accessibilityViewIsModal style={styles.dialog}>
          <Text accessibilityRole="header" style={text.subhead}>{creating ? 'Set an inventory PIN' : 'Enter inventory PIN'}</Text>
          <Text style={text.body}>
            {creating
              ? `No PIN is set yet. Choose ${EDIT_PIN_LENGTH.min} to ${EDIT_PIN_LENGTH.max} digits to ${purpose}. You will need it for deleting items and changing quantities.`
              : `Enter the PIN to ${purpose}.`}
          </Text>
          <FormField
            autoFocus
            keyboardType="number-pad"
            label={creating ? 'New PIN' : 'PIN'}
            maxLength={EDIT_PIN_LENGTH.max}
            onChangeText={setPin}
            onSubmitEditing={creating ? undefined : () => void submit()}
            secureTextEntry
            value={pin}
          />
          {creating ? (
            <FormField
              keyboardType="number-pad"
              label="Type the PIN again"
              maxLength={EDIT_PIN_LENGTH.max}
              onChangeText={setConfirmPin}
              onSubmitEditing={() => void submit()}
              secureTextEntry
              value={confirmPin}
            />
          ) : null}
          {error ? <Text accessibilityLiveRegion="polite" style={text.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <ActionButton disabled={busy || pin.length < EDIT_PIN_LENGTH.min} onPress={() => void submit()}>
              {busy ? 'Checking…' : creating ? 'Save PIN and continue' : 'Continue'}
            </ActionButton>
            <ActionButton disabled={busy} variant="secondary" onPress={close}>Cancel</ActionButton>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  return { requirePin, pinPrompt };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.scrim },
  dialog: {
    width: '100%',
    maxWidth: 420,
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.panel,
    backgroundColor: colors.surface,
  },
  actions: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.sm },
});
