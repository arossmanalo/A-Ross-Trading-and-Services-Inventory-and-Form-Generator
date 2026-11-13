import type { ComponentProps } from 'react';
import { StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';

import { colors } from '@/theme/colors';
import { fontSize, radius, text } from '@/theme/typography';

type FormFieldProps = ComponentProps<typeof TextInput> & {
  label: string;
  hint?: string;
  containerStyle?: ViewStyle;
};

export function FormField({ containerStyle, label, hint, style, ...inputProps }: FormFieldProps) {
  return (
    <View style={[styles.container, containerStyle]}>
      <Text selectable style={text.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        {...inputProps}
        placeholderTextColor={colors.secondaryLabel}
        style={[styles.input, style]}
      />
      {hint ? <Text selectable style={text.meta}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 5,
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.control,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    color: colors.label,
    fontSize: fontSize.body,
  },
});
