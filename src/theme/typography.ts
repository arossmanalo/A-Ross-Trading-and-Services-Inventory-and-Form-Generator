import type { TextStyle } from 'react-native';

import { colors } from '@/theme/colors';

/** Five text sizes, used everywhere instead of one-off font sizes. */
export const fontSize = {
  meta: 13,
  body: 15,
  subhead: 17,
  section: 20,
  title: 28,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

/** Two radii: controls and chips use `control`, panels use `panel`. */
export const radius = {
  control: 6,
  panel: 10,
} as const;

export const text = {
  title: { color: colors.label, fontSize: fontSize.title, lineHeight: 34, fontWeight: '600' },
  section: { color: colors.label, fontSize: fontSize.section, lineHeight: 26, fontWeight: '600' },
  subhead: { color: colors.label, fontSize: fontSize.subhead, lineHeight: 23, fontWeight: '600' },
  body: { color: colors.label, fontSize: fontSize.body, lineHeight: 22 },
  bodyStrong: { color: colors.label, fontSize: fontSize.body, lineHeight: 22, fontWeight: '600' },
  meta: { color: colors.secondaryLabel, fontSize: fontSize.meta, lineHeight: 18 },
  label: { color: colors.tertiaryLabel, fontSize: fontSize.meta, lineHeight: 18, fontWeight: '600' },
  amount: { color: colors.label, fontSize: fontSize.body, fontWeight: '600', fontVariant: ['tabular-nums'] },
  error: { color: colors.error, fontSize: fontSize.meta, lineHeight: 18 },
} satisfies Record<string, TextStyle>;
