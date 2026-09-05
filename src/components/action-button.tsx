import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { colors } from '@/theme/colors';

type ActionButtonProps = {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  compact?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  style?: ViewStyle;
};

export function ActionButton({
  children,
  compact = false,
  onPress,
  disabled = false,
  variant = 'primary',
  style,
}: ActionButtonProps) {
  const palette = variant === 'primary'
    ? { backgroundColor: colors.brandBlue, color: '#ffffff', borderColor: colors.brandBlue }
    : variant === 'danger'
      ? { backgroundColor: 'transparent', color: colors.error, borderColor: colors.error }
      : { backgroundColor: colors.surface, color: colors.label, borderColor: colors.separator };

  return (
    <Pressable
      accessibilityRole="button"
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
      <Text selectable style={[styles.label, compact ? styles.compactLabel : null, { color: palette.color }]}>
        {children}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderWidth: 1,
    borderCurve: 'continuous',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
  },
  compactButton: {
    minHeight: 40,
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  compactLabel: {
    fontSize: 14,
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.99 }],
  },
  disabled: {
    opacity: 0.45,
  },
});
