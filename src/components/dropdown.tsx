import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';

export type DropdownOption<T extends string> = { value: T; label: string };

type DropdownProps<T extends string> = {
  label: string;
  value: T;
  options: ReadonlyArray<DropdownOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
};

/**
 * A select control: a field showing the current choice that opens a list of
 * options. React Native has no cross-platform picker, so this uses a modal.
 */
export function Dropdown<T extends string>({ label, value, options, onChange, disabled = false }: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? ''}`}
        accessibilityHint="Opens a list of choices"
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.field, pressed ? styles.pressed : null, disabled ? styles.disabled : null]}
      >
        <Text numberOfLines={1} style={styles.value}>{current?.label ?? ''}</Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityLabel="Close choices" style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet} accessibilityViewIsModal>
            <Text style={styles.sheetTitle}>{label}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {options.map((option) => {
                const selected = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setOpen(false);
                      if (!selected) onChange(option.value);
                    }}
                    style={({ pressed }) => [styles.option, selected ? styles.optionSelected : null, pressed ? styles.pressed : null]}
                  >
                    <Text style={selected ? styles.optionTextSelected : styles.optionText}>{option.label}</Text>
                    {selected ? <Text style={styles.check}>✓</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, flexBasis: 150, minWidth: 140, gap: 5 },
  label: { color: colors.secondaryLabel, fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  field: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.separator,
    borderCurve: 'continuous',
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  value: { flex: 1, color: colors.label, fontSize: 14, fontWeight: '700' },
  chevron: { color: colors.secondaryLabel, fontSize: 14 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
  backdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 420,
    maxHeight: '75%',
    paddingVertical: 8,
    borderCurve: 'continuous',
    borderRadius: 18,
    backgroundColor: colors.background,
  },
  sheetTitle: { paddingHorizontal: 18, paddingVertical: 12, color: colors.label, fontSize: 16, fontWeight: '800' },
  option: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 },
  optionSelected: { backgroundColor: '#eaf2ff' },
  optionText: { color: colors.label, fontSize: 15 },
  optionTextSelected: { color: colors.brandNavy, fontSize: 15, fontWeight: '800' },
  check: { color: colors.brandBlue, fontSize: 16, fontWeight: '900' },
});
