import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';

type MetricCardProps = {
  label: string;
  value: ReactNode;
  accent?: 'blue' | 'red' | 'green';
};

const accents = {
  blue: colors.brandBlue,
  red: colors.brandRed,
  green: colors.success,
};

export function MetricCard({ label, value, accent = 'blue' }: MetricCardProps) {
  return (
    <View style={[styles.card, { borderTopColor: accents[accent] }]}>
      <Text selectable style={styles.value}>{value}</Text>
      <Text selectable style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minWidth: 142,
    flex: 1,
    gap: 5,
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderTopWidth: 4,
    boxShadow: '0 2px 10px rgba(15, 23, 42, 0.08)',
  },
  value: {
    color: colors.label,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  label: {
    color: colors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
});
