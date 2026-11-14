import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { fontSize, radius, spacing, text } from '@/theme/typography';

type NoticeProps = {
  tone?: 'info' | 'danger';
  label?: string;
  amount?: string;
  children?: ReactNode;
};

/**
 * A tinted box at the top of a sheet: what this form will do, and the amount
 * involved when there is one. Danger tone is for voids.
 */
export function Notice({ tone = 'info', label, amount, children }: NoticeProps) {
  const danger = tone === 'danger';
  return (
    <View style={[styles.notice, danger ? styles.danger : styles.info]}>
      {label ? <Text style={[text.label, danger ? styles.dangerText : styles.infoText]}>{label}</Text> : null}
      {amount ? <Text selectable style={styles.amount}>{amount}</Text> : null}
      {typeof children === 'string' ? <Text selectable style={text.body}>{children}</Text> : children}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { gap: spacing.xs, padding: spacing.lg, borderRadius: radius.panel, borderWidth: 1 },
  info: { backgroundColor: colors.accentTint, borderColor: colors.accentTint },
  danger: { backgroundColor: colors.errorTint, borderColor: colors.errorTint },
  infoText: { color: colors.primary },
  dangerText: { color: colors.error },
  amount: {
    color: colors.label,
    fontSize: fontSize.title,
    lineHeight: 34,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
