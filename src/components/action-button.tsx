import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { colors } from '@/theme/colors';
import { fontSize, radius } from '@/theme/typography';

type ActionButtonProps = {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  compact?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  style?: ViewStyle;
};

const palettes = {
  primary: { backgroundColor: colors.primary, color: colors.onPrimary, borderColor: colors.primary },
  secondary: { backgroundColor: colors.surface, color: colors.label, borderColor: colors.inputBorder },
  danger: { backgroundColor: colors.surface, color: colors.error, borderColor: colors.error },
};

export function ActionButton({
  children,
  compact = false,
  onPress,
  disabled = false,
  variant = 'primary',
  style,
}: ActionButtonProps) {
  const palette = palettes[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact ? styles.compactButton : null,
        { backgroundColor: palette.backgroundColor, borderColor: palette.borderColor },
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <Text pointerEvents="none" style={[styles.label, compact ? styles.compactLabel : null, { color: palette.color }]}>
        {children}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  label: {
    fontSize: fontSize.body,
    fontWeight: '600',
    textAlign: 'center',
  },
  compactButton: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  compactLabel: {
    fontSize: fontSize.meta + 1,
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.45,
  },
});
