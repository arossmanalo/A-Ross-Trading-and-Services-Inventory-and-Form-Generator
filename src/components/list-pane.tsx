import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { SalesTotalCard } from '@/components/sales-total-card';
import { colors } from '@/theme/colors';
import { fontSize, radius, spacing, text } from '@/theme/typography';

type ListTitleProps = {
  title: string;
  subtitle?: string;
  /** A text button beside the title, such as "Add customer". */
  actionLabel?: string;
  onAction?: () => void;
};

/** The section's name at the top of its list pane, with its main action beside it. */
export function ListTitle({ title, subtitle, actionLabel, onAction }: ListTitleProps) {
  return (
    <View style={styles.titleRow}>
      <View style={styles.titleCopy}>
        <Text accessibilityRole="header" style={text.title}>{title}</Text>
        {subtitle ? <Text style={text.meta}>{subtitle}</Text> : null}
      </View>
      {actionLabel && onAction ? <ActionButton compact onPress={onAction}>{actionLabel}</ActionButton> : null}
    </View>
  );
}

type ListSearchProps = {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
};

/** The search box at the top of a list pane. */
export function ListSearch({ query, onQueryChange, placeholder }: ListSearchProps) {
  return (
    <TextInput
      accessibilityLabel="Search"
      autoCapitalize="none"
      autoCorrect={false}
      numberOfLines={1}
      onChangeText={onQueryChange}
      placeholder={placeholder}
      placeholderTextColor={colors.secondaryLabel}
      returnKeyType="search"
      style={styles.search}
      value={query}
    />
  );
}

type ListPaneHeaderProps = {
  title: string;
  newLabel: string;
  onNew: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  searchPlaceholder: string;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  activeFilterCount: number;
  filters: ReactNode;
  countLine: string;
  showTotals: boolean;
  onToggleTotals: () => void;
  onClearFilters?: () => void;
  sales?: { totalCentavos: number; count: number; noun: string; nounPlural?: string };
  error?: string | null;
};

/**
 * Search, folding filters, the record count, the totals switch and the
 * filtered total of sales: the top of every document list.
 */
export function ListPaneHeader(props: ListPaneHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={[text.title, styles.titleCopy]}>{props.title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.newLabel}
          onPress={props.onNew}
          style={({ pressed }) => [styles.newButton, pressed ? styles.pressed : null]}
        >
          {/* The plus is an icon, so it keeps its size inside the 44px button. */}
          <Text maxFontSizeMultiplier={1} style={styles.newButtonText}>+</Text>
        </Pressable>
      </View>
      <ListSearch query={props.query} onQueryChange={props.onQueryChange} placeholder={props.searchPlaceholder} />
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: props.filtersOpen }}
          onPress={props.onToggleFilters}
          style={({ pressed }) => [styles.tool, props.activeFilterCount ? styles.toolActive : null, pressed ? styles.pressed : null]}
        >
          <Text style={[styles.toolText, props.activeFilterCount ? styles.toolTextActive : null]}>
            {props.activeFilterCount ? `Filters (${props.activeFilterCount})` : 'Filters'} {props.filtersOpen ? '▴' : '▾'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={props.onToggleTotals}
          style={({ pressed }) => [styles.tool, pressed ? styles.pressed : null]}
        >
          <Text style={styles.toolText}>{props.showTotals ? 'Hide totals' : 'Show totals'}</Text>
        </Pressable>
        {props.onClearFilters ? (
          <Pressable accessibilityRole="button" onPress={props.onClearFilters} style={({ pressed }) => [styles.tool, pressed ? styles.pressed : null]}>
            <Text style={styles.toolText}>Clear filters</Text>
          </Pressable>
        ) : null}
      </View>
      {props.filtersOpen ? <View style={styles.filters}>{props.filters}</View> : null}
      <Text style={text.meta}>{props.countLine}</Text>
      {props.sales ? (
        <SalesTotalCard
          totalCentavos={props.sales.totalCentavos}
          count={props.sales.count}
          noun={props.sales.noun}
          nounPlural={props.sales.nounPlural}
          hidden={!props.showTotals}
        />
      ) : null}
      {props.error ? <Text style={text.error}>{props.error}</Text> : null}
    </View>
  );
}

/** Empty or no-match message for a document list. */
export function ListEmpty({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={text.subhead}>{title}</Text>
      <Text style={[text.meta, styles.emptyBody]}>{body}</Text>
    </View>
  );
}

export const listRowStyles = StyleSheet.create({
  row: {
    gap: 3,
    paddingHorizontal: spacing.xl,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  selected: { backgroundColor: colors.accentTint, borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: spacing.xl - 3 },
  pressed: { backgroundColor: colors.subtleSurface },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  number: { flex: 1, color: colors.label, fontSize: fontSize.body, fontWeight: '600', fontVariant: ['tabular-nums'] },
  metaLine: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  linkChip: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  linkChipText: { color: colors.primary, fontSize: fontSize.meta, fontWeight: '600' },
});

const styles = StyleSheet.create({
  header: { gap: spacing.md, padding: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.separator, backgroundColor: colors.surface },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  titleCopy: { flexShrink: 1 },
  newButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    backgroundColor: colors.primary,
  },
  newButtonText: { color: colors.onPrimary, fontSize: fontSize.title, lineHeight: 32, fontWeight: '500' },
  search: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.control,
    backgroundColor: colors.subtleSurface,
    color: colors.label,
    fontSize: fontSize.body,
  },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tool: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
  },
  toolActive: { borderColor: colors.primary, backgroundColor: colors.accentTint },
  toolText: { color: colors.tertiaryLabel, fontSize: fontSize.meta, fontWeight: '600' },
  toolTextActive: { color: colors.brandNavy },
  pressed: { opacity: 0.75 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.xxl },
  emptyBody: { maxWidth: 320, textAlign: 'center' },
});
