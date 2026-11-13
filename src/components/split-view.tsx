import type { ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { colors } from '@/theme/colors';
import { spacing, text } from '@/theme/typography';

/** Wide enough (tablet in landscape) to show a list and the selected record side by side. */
export const SPLIT_MIN_WINDOW_WIDTH = 1000;

export function useSplitLayout(): boolean {
  return useWindowDimensions().width >= SPLIT_MIN_WINDOW_WIDTH;
}

type SplitViewProps = {
  list: ReactNode;
  detail: ReactNode | null;
  /** Shown in the detail pane until a record is selected. */
  emptyTitle: string;
  emptyBody: string;
  listWidth?: number;
};

/** List on the left, the selected record on the right. Only used when `useSplitLayout()` is true. */
export function SplitView({ list, detail, emptyTitle, emptyBody, listWidth = 380 }: SplitViewProps) {
  return (
    <View style={styles.root}>
      <View style={[styles.list, { width: listWidth }]}>{list}</View>
      <View style={styles.detail}>
        {detail ?? (
          <View style={styles.empty}>
            <Text style={text.subhead}>{emptyTitle}</Text>
            <Text style={[text.meta, styles.emptyBody]}>{emptyBody}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  list: { borderRightWidth: 1, borderRightColor: colors.separator, backgroundColor: colors.surface },
  detail: { flex: 1, minWidth: 0 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xxl },
  emptyBody: { maxWidth: 360, textAlign: 'center' },
});
