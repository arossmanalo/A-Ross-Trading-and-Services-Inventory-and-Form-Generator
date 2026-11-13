import { StyleSheet, Text } from 'react-native';

import { colors } from '@/theme/colors';
import { fontSize, radius } from '@/theme/typography';

export type ChipTone = 'draft' | 'final' | 'void' | 'neutral' | 'accent';

const TONES: Record<ChipTone, { backgroundColor: string; color: string }> = {
  draft: { backgroundColor: colors.warningTint, color: colors.warning },
  final: { backgroundColor: colors.successTint, color: colors.success },
  void: { backgroundColor: colors.errorTint, color: colors.error },
  neutral: { backgroundColor: colors.neutralTint, color: colors.tertiaryLabel },
  accent: { backgroundColor: colors.accentTint, color: colors.brandNavy },
};

/** The chip tone for a document's state. */
export function documentStateTone(state: string): ChipTone {
  if (state === 'draft') return 'draft';
  if (state === 'voided') return 'void';
  return 'final';
}

/** "draft" → "Draft", "waiting_for_parts" → "Waiting for parts". */
export function sentenceCase(value: string): string {
  const spaced = value.replaceAll('_', ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function StatusChip({ label, tone }: { label: string; tone: ChipTone }) {
  return <Text style={[styles.chip, TONES[tone]]}>{label}</Text>;
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.control,
    fontSize: fontSize.meta,
    fontWeight: '600',
  },
});
