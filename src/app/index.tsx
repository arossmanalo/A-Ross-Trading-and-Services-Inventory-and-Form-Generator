import { Link, router, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';

import { ActionButton } from '@/components/action-button';
import { MetricCard } from '@/components/metric-card';
import { runDatabaseSelfCheck, type DatabaseSelfCheck } from '@/db/phase-zero-check';
import type { BackupStatus } from '@/features/backup/backup-repository';
import { getDashboardSummary, type DashboardActivity } from '@/features/reports/dashboard-summary';
import { colors } from '@/theme/colors';

type DashboardCounts = {
  activeItems: number;
  lowStockItems: number;
  customers: number;
  backupStatus: BackupStatus;
  recentActivity: DashboardActivity[];
};

const EMPTY_COUNTS: DashboardCounts = {
  activeItems: 0,
  lowStockItems: 0,
  customers: 0,
  backupStatus: {
    currentRevision: 0,
    lastExport: null,
    revisionsNotExported: 0,
    finalizedRecordCount: 0,
    noticeDue: false,
  },
  recentActivity: [],
};

export default function DashboardScreen() {
  useColorScheme();
  const db = useSQLiteContext();
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [countsError, setCountsError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<DatabaseSelfCheck | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    setCountsError(null);
    void getDashboardSummary(db)
      .then((summary) => {
        if (active) {
          setCounts(summary);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setCountsError(error instanceof Error ? error.message : 'Could not load dashboard totals.');
        }
      });

    return () => {
      active = false;
    };
  }, [db]));

  const runSelfCheck = useCallback(async () => {
    setChecking(true);
    setCheckError(null);
    try {
      setCheckResult(await runDatabaseSelfCheck(db));
    } catch (error) {
      setCheckResult(null);
      setCheckError(error instanceof Error ? error.message : 'Database self-check failed.');
    } finally {
      setChecking(false);
    }
  }, [db]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      <View style={styles.hero}>
        <View style={styles.brandMark}>
          <Image
            accessibilityLabel="A.Ross Trading and Services logo"
            contentFit="contain"
            source={require('../../assets/a-ross-logo.png')}
            style={styles.brandLogo}
          />
        </View>
        <View style={styles.heroCopy}>
          <Text selectable style={styles.eyebrow}>OFFLINE WORKSPACE</Text>
          <Text selectable style={styles.heroTitle}>Ready for the day’s service work.</Text>
          <Text selectable style={styles.heroSubtitle}>
            Inventory and records stay on this device. No connection required.
          </Text>
        </View>
      </View>

      <View style={styles.metrics}>
        <MetricCard label="Active items" value={counts.activeItems} />
        <MetricCard
          accent={counts.lowStockItems > 0 ? 'red' : 'green'}
          label="Low stock"
          value={counts.lowStockItems}
        />
        <MetricCard label="Customers" value={counts.customers} />
      </View>
      {countsError ? <Text selectable style={styles.errorText}>{countsError}</Text> : null}

      <View style={styles.section}>
        <Text selectable style={styles.sectionTitle}>Start here</Text>
        <ActionButton variant={counts.backupStatus.noticeDue ? 'primary' : 'secondary'} onPress={() => router.push('/backup')}>Backup</ActionButton>
        <ActionButton onPress={() => router.push('/search')}>Search records</ActionButton>
        <ActionButton onPress={() => router.push('/reports')}>Financial reports</ActionButton>
        <ActionButton variant="secondary" onPress={() => router.push('/reports/stock')}>Stock report</ActionButton>
        <ActionButton variant="secondary" onPress={() => router.push('/reports/movements')}>Movement report</ActionButton>
        <ActionButton variant="secondary" onPress={() => router.push('/reports/audit')}>Audit report</ActionButton>
        <ActionButton variant="secondary" onPress={() => router.push('/reports/collections')}>Collections report</ActionButton>
        <ActionButton variant="secondary" onPress={() => router.push('/reports/sales')}>Sales report</ActionButton>
        <Link href="/inventory" asChild>
          <Pressable accessibilityRole="button" accessibilityHint="Open Inventory" style={({ pressed }) => [styles.featureCard, pressed ? styles.pressed : null]}>
            <View style={styles.featureIcon}>
              <Text selectable style={styles.featureIconText}>01</Text>
            </View>
            <View style={styles.featureCopy}>
              <Text selectable style={styles.featureTitle}>Inventory</Text>
              <Text selectable style={styles.featureBody}>
                Add items and opening stock, with every movement recorded.
              </Text>
            </View>
            <Text selectable style={styles.chevron}>›</Text>
          </Pressable>
        </Link>

        <Link href="/customers" asChild>
          <Pressable accessibilityRole="button" accessibilityHint="Open Customers and equipment" style={({ pressed }) => [styles.featureCard, pressed ? styles.pressed : null]}>
            <View style={styles.featureIcon}>
              <Text selectable style={styles.featureIconText}>02</Text>
            </View>
            <View style={styles.featureCopy}>
              <Text selectable style={styles.featureTitle}>Customers & equipment</Text>
              <Text selectable style={styles.featureBody}>
                Register customers and keep reusable machine records together.
              </Text>
            </View>
            <Text selectable style={styles.chevron}>›</Text>
          </Pressable>
        </Link>

        <Link href="/services" asChild>
          <Pressable accessibilityRole="button" accessibilityHint="Open Service catalog" style={({ pressed }) => [styles.featureCard, pressed ? styles.pressed : null]}>
            <View style={styles.featureIcon}>
              <Text selectable style={styles.featureIconText}>03</Text>
            </View>
            <View style={styles.featureCopy}>
              <Text selectable style={styles.featureTitle}>Service catalog</Text>
              <Text selectable style={styles.featureBody}>
                Maintain owner-controlled labor and service rates.
              </Text>
            </View>
            <Text selectable style={styles.chevron}>›</Text>
          </Pressable>
        </Link>

        <Link href="/settings" asChild>
          <Pressable accessibilityRole="button" accessibilityHint="Open Settings" style={({ pressed }) => [styles.featureCard, pressed ? styles.pressed : null]}>
            <View style={styles.featureIcon}>
              <Text selectable style={styles.featureIconText}>04</Text>
            </View>
            <View style={styles.featureCopy}>
              <Text selectable style={styles.featureTitle}>Settings</Text>
              <Text selectable style={styles.featureBody}>
                Business identity and low-stock notification preference.
              </Text>
            </View>
            <Text selectable style={styles.chevron}>›</Text>
          </Pressable>
        </Link>

        <Link href="/service-reports" asChild>
          <Pressable accessibilityRole="button" accessibilityHint="Open Customer service reports" style={({ pressed }) => [styles.featureCard, pressed ? styles.pressed : null]}>
            <View style={styles.featureIcon}>
            <Text selectable style={styles.featureIconText}>05</Text>
            </View>
            <View style={styles.featureCopy}>
              <Text selectable style={styles.featureTitle}>Customer service reports</Text>
              <Text selectable style={styles.featureBody}>Draft, finalize, render, and share service records.</Text>
            </View>
            <Text selectable style={styles.chevron}>›</Text>
          </Pressable>
        </Link>

        <Link href="/billing-statements" asChild>
          <Pressable accessibilityRole="button" accessibilityHint="Open Billing statements" style={({ pressed }) => [styles.featureCard, pressed ? styles.pressed : null]}>
            <View style={styles.featureIcon}>
              <Text selectable style={styles.featureIconText}>06</Text>
            </View>
            <View style={styles.featureCopy}>
              <Text selectable style={styles.featureTitle}>Billing statements</Text>
              <Text selectable style={styles.featureBody}>
                Combine charges, expenses, discounts, PDFs, and direct inventory sales.
              </Text>
            </View>
            <Text selectable style={styles.chevron}>›</Text>
          </Pressable>
        </Link>

        <Link href="/payments" asChild>
          <Pressable accessibilityRole="button" accessibilityHint="Open Payments" style={({ pressed }) => [styles.featureCard, pressed ? styles.pressed : null]}>
            <View style={styles.featureIcon}>
              <Text selectable style={styles.featureIconText}>07</Text>
            </View>
            <View style={styles.featureCopy}>
              <Text selectable style={styles.featureTitle}>Payments</Text>
              <Text selectable style={styles.featureBody}>
                Review numbered acknowledgments and payment corrections.
              </Text>
            </View>
            <Text selectable style={styles.chevron}>›</Text>
          </Pressable>
        </Link>
      </View>

      <View style={styles.section}>
        <Text selectable style={styles.sectionTitle}>Backup</Text>
        <View style={styles.activityCard}>
          <Text selectable style={styles.activityEvent}>
            {counts.backupStatus.revisionsNotExported === 0 ? 'Latest export is current' : `${counts.backupStatus.revisionsNotExported} revision(s) need export`}
          </Text>
          <Text selectable style={[styles.featureBody, counts.backupStatus.noticeDue ? styles.warningText : null]}>
            {counts.backupStatus.noticeDue ? 'Seven-day backup notice is due.' : 'Manual private Drive upload after export.'}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text selectable style={styles.sectionTitle}>Recent activity</Text>
        {counts.recentActivity.length > 0 ? counts.recentActivity.map(activity => (
          <View key={activity.id} style={styles.activityCard}>
            <Text selectable style={styles.activityEvent}>{activity.eventType}</Text>
            <Text selectable style={styles.featureBody}>
              {formatEntity(activity.entityType)} - {activity.createdAt}
            </Text>
          </View>
        )) : (
          <Text selectable style={styles.featureBody}>No activity recorded yet.</Text>
        )}
      </View>

      <View style={styles.diagnostic}>
        <View style={styles.diagnosticHeader}>
          <View style={styles.diagnosticCopy}>
            <Text selectable style={styles.sectionTitle}>Phase 0 database check</Text>
            <Text selectable style={styles.featureBody}>
              Verifies schema migration and rollback on the actual device.
            </Text>
          </View>
          {checking ? <ActivityIndicator color={colors.brandBlue} /> : null}
        </View>
        <ActionButton disabled={checking} onPress={runSelfCheck} variant="secondary">
          {checking ? 'Checking…' : 'Run database self-check'}
        </ActionButton>
        {checkResult ? (
          <Text selectable style={styles.successText}>
            SQLite {checkResult.sqliteVersion} · schema {checkResult.schemaVersion} · rollback{' '}
            {checkResult.rollbackVerified ? 'verified' : 'FAILED'}
          </Text>
        ) : null}
        {checkError ? <Text selectable style={styles.errorText}>{checkError}</Text> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    paddingBottom: 44,
    gap: 24,
  },
  hero: {
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    padding: 22,
    backgroundColor: colors.brandNavy,
    borderRadius: 24,
    borderCurve: 'continuous',
  },
  brandMark: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderCurve: 'continuous',
  },
  brandLogo: {
    width: 66,
    height: 42,
  },
  heroCopy: {
    flex: 1,
    gap: 5,
  },
  eyebrow: {
    color: '#a9c9f5',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '800',
  },
  heroSubtitle: {
    color: '#d7e5f8',
    fontSize: 14,
    lineHeight: 20,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: colors.label,
    fontSize: 19,
    fontWeight: '800',
  },
  featureCard: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 18,
    borderCurve: 'continuous',
    boxShadow: '0 2px 10px rgba(15, 23, 42, 0.07)',
  },
  featureDisabled: {
    opacity: 0.62,
  },
  featureIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: '#dbeafe',
  },
  featureIconMuted: {
    backgroundColor: '#e8ebf0',
  },
  featureIconText: {
    color: colors.brandNavy,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  featureCopy: {
    flex: 1,
    gap: 4,
  },
  featureTitle: {
    color: colors.label,
    fontSize: 16,
    fontWeight: '800',
  },
  featureBody: {
    color: colors.secondaryLabel,
    fontSize: 13,
    lineHeight: 18,
  },
  chevron: {
    color: colors.secondaryLabel,
    fontSize: 30,
    fontWeight: '400',
  },
  comingSoon: {
    color: colors.secondaryLabel,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  activityCard: {
    padding: 14,
    gap: 4,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
  },
  activityEvent: {
    color: colors.label,
    fontSize: 14,
    fontWeight: '800',
  },
  diagnostic: {
    gap: 14,
    padding: 17,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
  },
  diagnosticHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  diagnosticCopy: {
    flex: 1,
    gap: 4,
  },
  successText: {
    color: colors.success,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    lineHeight: 18,
  },
  warningText: {
    color: colors.warning,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.995 }],
  },
});

function formatEntity(entityType: string): string {
  return entityType.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}
