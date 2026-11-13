import { router, usePathname, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { fontSize, spacing } from '@/theme/typography';

const REPORTS: Array<{ label: string; href: Href; path: string }> = [
  { label: 'Financial', href: '/reports', path: '/reports' },
  { label: 'Sales', href: '/reports/sales', path: '/reports/sales' },
  { label: 'Collections', href: '/reports/collections', path: '/reports/collections' },
  { label: 'Stock', href: '/reports/stock', path: '/reports/stock' },
  { label: 'Movements', href: '/reports/movements', path: '/reports/movements' },
  { label: 'Audit', href: '/reports/audit', path: '/reports/audit' },
];

/** Tabs across the top of every report, so switching reports does not stack screens. */
export function ReportFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <View style={styles.root}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={styles.tabs}>
        {REPORTS.map((report) => {
          const active = pathname === report.path;
          return (
            <Pressable
              key={report.path}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => { if (!active) router.replace(report.href); }}
              style={({ pressed }) => [styles.tab, active ? styles.tabActive : null, pressed && !active ? styles.tabPressed : null]}
            >
              <Text style={[styles.tabText, active ? styles.tabTextActive : null]}>{report.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabBar: { flexGrow: 0, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.separator },
  tabs: { paddingHorizontal: spacing.lg, gap: spacing.xs },
  tab: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.primary },
  tabPressed: { backgroundColor: colors.subtleSurface },
  tabText: { color: colors.secondaryLabel, fontSize: fontSize.body, fontWeight: '600' },
  tabTextActive: { color: colors.brandNavy },
  body: { flex: 1 },
});
