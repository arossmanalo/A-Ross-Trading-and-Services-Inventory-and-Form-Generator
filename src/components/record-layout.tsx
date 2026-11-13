import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors } from '@/theme/colors';
import { radius, spacing, text } from '@/theme/typography';

type RecordHeaderProps = {
  title: string;
  chips?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
};

/** Title row of a record: number or name, status chips, a subtitle line and its actions. */
export function RecordHeader({ title, chips, subtitle, actions }: RecordHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <View style={styles.titleLine}>
          <Text accessibilityRole="header" selectable style={[text.title, styles.title]}>{title}</Text>
          {chips}
        </View>
        {subtitle ? <Text selectable style={[text.body, styles.subtitle]}>{subtitle}</Text> : null}
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

/** A white bordered block for tables and grouped rows. */
export function Panel({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

/** A small label above a value, for facts such as "Machine" or "Signature status". */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.fact}>
      <Text style={text.meta}>{label}</Text>
      {typeof children === 'string' ? <Text selectable style={text.body}>{children}</Text> : children}
    </View>
  );
}

/** A section title with optional trailing content such as an "Add" button. */
export function SectionTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <Text accessibilityRole="header" style={text.subhead}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  headerCopy: { flexGrow: 1, flexBasis: 260, gap: 2 },
  titleLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  title: { fontVariant: ['tabular-nums'] },
  subtitle: { color: colors.secondaryLabel },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  panel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: radius.panel,
    overflow: 'hidden',
  },
  fact: { gap: 2, flexGrow: 1, flexBasis: 180 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, minHeight: 44 },
});
