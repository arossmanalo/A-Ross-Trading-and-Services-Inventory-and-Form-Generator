import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius, spacing, text } from '@/theme/typography';

/** A scrolling page with a readable maximum width, for settings-style screens. */
export function PageBody({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

type PageSectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
};

/**
 * A titled group of settings. On wide screens the title and description sit
 * to the left of the content; on narrow screens they stack above it.
 */
export function PageSection({ title, description, children }: PageSectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={text.subhead}>{title}</Text>
        {description ? <Text selectable style={text.meta}>{description}</Text> : null}
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

/** A tinted note inside a page, for warnings that should not be missed. */
export function PageNote({ tone, title, children }: { tone: 'warning' | 'info'; title: string; children: string }) {
  return (
    <View style={[styles.note, tone === 'warning' ? styles.noteWarning : styles.noteInfo]}>
      <Text style={[text.bodyStrong, tone === 'warning' ? styles.warningText : null]}>{title}</Text>
      <Text selectable style={text.body}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xxl, padding: spacing.xxl, paddingBottom: spacing.xxl * 2, width: '100%', maxWidth: 960 },
  section: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xl,
    paddingBottom: spacing.xxl,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  heading: { flexGrow: 1, flexBasis: 220, maxWidth: 320, gap: spacing.xs },
  body: { flexGrow: 2, flexBasis: 380, gap: spacing.lg },
  note: { gap: spacing.xs, padding: spacing.lg, borderRadius: radius.panel, borderWidth: 1 },
  noteWarning: { backgroundColor: colors.warningTint, borderColor: colors.warningBorder },
  noteInfo: { backgroundColor: colors.accentTint, borderColor: colors.accentTint },
  warningText: { color: colors.warning },
});
