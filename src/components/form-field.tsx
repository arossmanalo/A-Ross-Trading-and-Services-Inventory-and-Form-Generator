import type { ComponentProps } from 'react';
import { StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';

import { colors } from '@/theme/colors';

type FormFieldProps = ComponentProps<typeof TextInput> & {
  label: string;
  hint?: string;
  containerStyle?: ViewStyle;
};

export function FormField({ containerStyle, label, hint, style, ...inputProps }: FormFieldProps) {
  return (
    <View style={[styles.container, containerStyle]}>
      <Text selectable style={styles.label}>{label}</Text>
      <TextInput
        {...inputProps}
        placeholderTextColor={colors.secondaryLabel}
        style={[styles.input, style]}
      />
      {hint ? <Text selectable style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 7,
  },
  label: {
    color: colors.label,
    fontSize: 14,
    fontWeight: '700',
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.separator,
    borderCurve: 'continuous',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: colors.surface,
    color: colors.label,
    fontSize: 16,
  },
  hint: {
    color: colors.secondaryLabel,
    fontSize: 12,
    lineHeight: 17,
  },
});
