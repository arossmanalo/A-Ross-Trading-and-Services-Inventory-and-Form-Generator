import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { spacing, text } from '@/theme/typography';

type SheetBodyProps = {
  children: ReactNode;
  /** The error from the last attempt, shown right above the actions. */
  error?: string | null;
  /** The sheet's primary action, and any secondary one beside it. */
  actions?: ReactNode;
};

/**
 * The scrolling body of a form sheet. The actions sit at the end of the
 * content rather than pinned, so the on-screen keyboard never covers fields.
 */
export function SheetBody({ children, error, actions }: SheetBodyProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
    >
      {children}
      {error || actions ? (
        <View style={styles.footer}>
          {error ? <Text selectable style={text.error}>{error}</Text> : null}
          {actions ? <View style={styles.actions}>{actions}</View> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

/** A labelled group of fields inside a sheet. */
export function SheetSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" style={text.subhead}>{title}</Text>
        {hint ? <Text selectable style={text.meta}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/** Centred loading or error text for a sheet that is still fetching its record. */
export function SheetMessage({ children }: { children: string }) {
  return (
    <View style={styles.message}>
      <Text selectable style={text.meta}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, padding: spacing.xl, paddingBottom: spacing.xxl * 2 },
  footer: {
    gap: spacing.md,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  // The primary action comes first in the markup and lands at the right edge, Cancel to its left.
  actions: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.sm },
  section: { gap: spacing.md },
  sectionHeading: { gap: 2 },
  message: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
});
