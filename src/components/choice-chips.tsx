import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { fontSize, radius, spacing, text } from '@/theme/typography';

export type ChoiceOption<T extends string> = { value: T; label: string };

type ChoiceChipsProps<T extends string> = {
  label?: string;
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
};

/** A single-choice row of chips, such as payment method or charge type. */
export function ChoiceChips<T extends string>({ label, options, value, onChange }: ChoiceChipsProps<T>) {
  return (
    <View style={styles.container}>
      {label ? <Text style={text.label}>{label}</Text> : null}
      <View accessibilityRole="radiogroup" style={styles.row}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected, checked: selected }}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.chip,
                selected ? styles.selected : null,
                pressed && !selected ? styles.pressed : null,
              ]}
            >
              <Text style={[styles.chipText, selected ? styles.selectedText : null]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 5 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
  },
  selected: { borderColor: colors.primary, backgroundColor: colors.primary },
  pressed: { backgroundColor: colors.neutralTint },
  chipText: { color: colors.label, fontSize: fontSize.body, fontWeight: '600' },
  selectedText: { color: colors.onPrimary },
});
