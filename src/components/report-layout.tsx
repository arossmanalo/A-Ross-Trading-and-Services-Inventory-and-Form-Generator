import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FormField } from '@/components/form-field';
import { colors } from '@/theme/colors';
import { radius, spacing, text } from '@/theme/typography';

type ReportControlsProps = {
  /** One sentence on what the report counts and by which date. */
  intro: string;
  children: ReactNode;
  /** Generate and export buttons. */
  actions: ReactNode;
  error?: string | null;
};

/** The filter panel at the top of a report: intro, filters, then the actions. */
export function ReportControls({ intro, children, actions, error }: ReportControlsProps) {
  return (
    <View style={styles.controls}>
      <Text selectable style={text.meta}>{intro}</Text>
      <View style={styles.filters}>{children}</View>
      <View style={styles.actions}>{actions}</View>
      {error ? <Text selectable style={text.error}>{error}</Text> : null}
    </View>
  );
}

/** Lays filter fields side by side, wrapping onto new rows when space runs out. */
export function ReportFieldRow({ children }: { children: ReactNode }) {
  return <View style={styles.fieldRow}>{children}</View>;
}

/** Wraps one filter field so it shares a row evenly. */
export function ReportField({ children }: { children: ReactNode }) {
  return <View style={styles.field}>{children}</View>;
}

type ScopeOption = { id: string; title: string; detail?: string };

type ReportScopeProps = {
  label: string;
  allLabel: string;
  query: string;
  onQueryChange: (value: string) => void;
  selectedTitle: string | null;
  onClear: () => void;
  matches: ScopeOption[];
  onPick: (id: string) => void;
  disabled?: boolean;
};

/** Narrows a report to one customer or item, found by typing part of its name. */
export function ReportScope(props: ReportScopeProps) {
  const { label, allLabel, query, onQueryChange, selectedTitle, onClear, matches, onPick, disabled = false } = props;
  return (
    <View style={styles.scope}>
      <View style={styles.scopeLine}>
        <Text style={text.label}>Showing</Text>
        <Text selectable style={text.bodyStrong}>{selectedTitle ?? allLabel}</Text>
        {selectedTitle ? (
          <Pressable accessibilityRole="button" disabled={disabled} hitSlop={8} onPress={onClear}>
            <Text style={styles.link}>Show {allLabel.toLowerCase()}</Text>
          </Pressable>
        ) : null}
      </View>
      <FormField label={label} value={query} onChangeText={onQueryChange} editable={!disabled} />
      {matches.length ? (
        <View style={styles.matches}>
          {matches.map((match) => (
            <Pressable
              key={match.id}
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => onPick(match.id)}
              style={({ pressed }) => [styles.match, pressed ? styles.pressed : null]}
            >
              <Text style={text.bodyStrong}>{match.title}</Text>
              {match.detail ? <Text style={text.meta}>{match.detail}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The count and totals line between the filters and the rows. */
export function ReportSummary({ children }: { children: ReactNode }) {
  return <View style={styles.summary}>{children}</View>;
}

/** One figure in the summary line, such as "Rows 24" or "Net −3". */
export function ReportFigure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.figure}>
      <Text style={text.meta}>{label}</Text>
      <Text selectable style={[text.subhead, styles.tabular]}>{value}</Text>
    </View>
  );
}

type ReportRowProps = {
  title: string;
  /** Right-aligned figure: an amount or a quantity change. */
  figure?: string;
  figureTone?: 'positive' | 'negative';
  meta: string[];
  /** A highlighted note such as a void reason or price override. */
  note?: { text: string; tone: 'warning' | 'error' } | null;
  onPress?: () => void;
};

/** One line of a report, opening its source record when tapped. */
export function ReportRow({ title, figure, figureTone, meta, note, onPress }: ReportRowProps) {
  const body = (
    <>
      <View style={styles.rowTop}>
        <Text selectable style={[text.bodyStrong, styles.rowTitle]}>{title}</Text>
        {figure ? (
          <Text
            selectable
            style={[
              text.amount,
              figureTone === 'positive' ? styles.positive : null,
              figureTone === 'negative' ? styles.negative : null,
            ]}
          >
            {figure}
          </Text>
        ) : null}
      </View>
      {meta.map((line, index) => <Text key={index} selectable style={text.meta}>{line}</Text>)}
      {note ? (
        <Text selectable style={[text.meta, note.tone === 'error' ? styles.negative : styles.warning]}>{note.text}</Text>
      ) : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      {body}
    </Pressable>
  );
}

/** Empty or loading text shown in place of the rows. */
export function ReportEmpty({ children }: { children: string }) {
  return <Text selectable style={[text.meta, styles.empty]}>{children}</Text>;
}

export const reportListStyles = StyleSheet.create({
  content: { paddingBottom: spacing.xxl * 2 },
});

const styles = StyleSheet.create({
  controls: {
    gap: spacing.lg,
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  filters: { gap: spacing.lg },
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  field: { flexGrow: 1, flexBasis: 220 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  scope: { gap: spacing.sm },
  scopeLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: spacing.sm },
  link: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  matches: {
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: radius.control,
    overflow: 'hidden',
  },
  match: {
    gap: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  figure: { gap: 0 },
  tabular: { fontVariant: ['tabular-nums'] },
  row: {
    gap: 3,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  rowTitle: { flex: 1 },
  positive: { color: colors.success },
  negative: { color: colors.error },
  warning: { color: colors.warning },
  pressed: { backgroundColor: colors.subtleSurface },
  empty: { padding: spacing.xl },
});
