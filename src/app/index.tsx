import { router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ActionButton } from '@/components/action-button';
import { useAppWidth } from '@/components/app-width';
import { formatDisplayDate } from '@/domain/calendar';
import { getLocalBusinessDate } from '@/domain/business-date';
import { formatCentavos } from '@/domain/money';
import type { BackupStatus } from '@/features/backup/backup-repository';
import { listBillingStatements } from '@/features/billing-statements/billing-statement-repository';
import { listDeliveries } from '@/features/deliveries/delivery-repository';
import { listInventoryItems } from '@/features/inventory/inventory-repository';
import { listQuotations } from '@/features/quotations/quotation-repository';
import { getDashboardSummary } from '@/features/reports/dashboard-summary';
import { buildOverviewLists, type OpenDraft, type OverviewLists } from '@/features/reports/overview';
import { listServiceReports } from '@/features/service-reports/service-report-repository';
import { colors } from '@/theme/colors';
import { fontSize, radius, spacing, text } from '@/theme/typography';

type Overview = OverviewLists & {
  activeItems: number;
  lowStockItems: number;
  customers: number;
  backupStatus: BackupStatus;
};

const DRAFT_LABELS: Record<OpenDraft['kind'], string> = {
  service_report: 'CSR draft',
  quotation: 'Quotation draft',
  delivery: 'Delivery draft',
  billing_statement: 'Statement draft',
};

function draftHref(draft: OpenDraft): Href {
  switch (draft.kind) {
    case 'service_report':
      return { pathname: '/service-reports/[report-id]', params: { 'report-id': draft.id } };
    case 'quotation':
      return { pathname: '/quotations/[quotation-id]', params: { 'quotation-id': draft.id } };
    case 'delivery':
      return { pathname: '/deliveries/[delivery-id]', params: { 'delivery-id': draft.id } };
    case 'billing_statement':
      return { pathname: '/billing-statements/[statement-id]', params: { 'statement-id': draft.id } };
  }
}

/** Sections reached from the Overview on a phone, where the side menu is hidden. */
const PHONE_LINKS: Array<{ label: string; href: Href }> = [
  { label: 'Service reports', href: '/service-reports' },
  { label: 'Quotations', href: '/quotations' },
  { label: 'Deliveries', href: '/deliveries' },
  { label: 'Billing statements', href: '/billing-statements' },
  { label: 'Payments', href: '/payments' },
  { label: 'Customers', href: '/customers' },
  { label: 'Inventory', href: '/inventory' },
  { label: 'Service catalog', href: '/services' },
  { label: 'Reports', href: '/reports' },
  { label: 'Backup', href: '/backup' },
  { label: 'Settings', href: '/settings' },
];

export default function OverviewScreen() {
  const db = useSQLiteContext();
  const width = useAppWidth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useFocusEffect(useCallback(() => {
    let active = true;
    setError(null);
    void Promise.all([
      getDashboardSummary(db),
      listServiceReports(db),
      listQuotations(db),
      listDeliveries(db),
      listBillingStatements(db),
      listInventoryItems(db),
    ])
      .then(([summary, serviceReports, quotations, deliveries, statements, items]) => {
        if (!active) return;
        setOverview({
          activeItems: summary.activeItems,
          lowStockItems: summary.lowStockItems,
          customers: summary.customers,
          backupStatus: summary.backupStatus,
          ...buildOverviewLists({ serviceReports, quotations, deliveries, statements, items }),
        });
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not load the overview.');
      });
    return () => {
      active = false;
    };
  }, [db]));

  const openSearch = () => {
    const trimmed = query.trim();
    router.push(trimmed ? { pathname: '/search', params: { q: trimmed } } : '/search');
  };

  const wide = width >= 900;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <View style={styles.headerTitle}>
          <Text accessibilityRole="header" style={text.title}>Overview</Text>
          <Text style={text.meta}>{formatDisplayDate(getLocalBusinessDate())}</Text>
        </View>
        <TextInput
          accessibilityLabel="Search all records"
          onChangeText={setQuery}
          onSubmitEditing={openSearch}
          placeholder="Search customers, CSRs, statements, serial no."
          placeholderTextColor={colors.secondaryLabel}
          returnKeyType="search"
          style={styles.search}
          value={query}
        />
        <ActionButton compact onPress={() => router.push('/service-reports/new')}>New CSR</ActionButton>
      </View>

      {error ? <Text style={text.error}>{error}</Text> : null}
      {!overview && !error ? <ActivityIndicator color={colors.primary} style={styles.loading} /> : null}

      {overview ? (
        <>
          <View style={styles.figures}>
            <Figure label="Active items" value={String(overview.activeItems)} />
            <Figure label="Low stock" value={String(overview.lowStockItems)} warn={overview.lowStockItems > 0} />
            <Figure label="Customers" value={String(overview.customers)} />
            <Figure label="Open drafts" value={String(overview.drafts.length)} />
          </View>

          <View style={[styles.columns, wide ? styles.columnsWide : null]}>
            <View style={[styles.column, wide ? styles.mainColumn : null]}>
              <View style={styles.sectionHeading}>
                <Text accessibilityRole="header" style={text.section}>Open drafts</Text>
                <Text style={text.meta}>{overview.drafts.length === 1 ? '1 not finalized' : `${overview.drafts.length} not finalized`}</Text>
              </View>
              {overview.drafts.length === 0 ? (
                <Text style={[text.meta, styles.empty]}>No drafts. New CSRs, quotations, deliveries and statements start here as drafts until you finalize them.</Text>
              ) : (
                <View style={styles.panel}>
                  {overview.drafts.map((draft, index) => (
                    <Pressable
                      key={`${draft.kind}:${draft.id}`}
                      accessibilityRole="link"
                      onPress={() => router.push(draftHref(draft))}
                      style={({ pressed }) => [styles.draftRow, index > 0 ? styles.rowDivider : null, pressed ? styles.pressed : null]}
                    >
                      <Text style={[text.label, styles.draftKind]}>{DRAFT_LABELS[draft.kind]}</Text>
                      <View style={styles.draftCopy}>
                        <Text numberOfLines={1} style={text.bodyStrong}>{draft.customerName}</Text>
                        <Text style={text.meta}>{formatDisplayDate(draft.businessDate)}</Text>
                      </View>
                      <Text style={text.amount}>{formatCentavos(draft.totalCentavos)}</Text>
                      <Text style={styles.chevron}>›</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <View style={[styles.column, wide ? styles.sideColumn : null]}>
              <Text accessibilityRole="header" style={text.section}>Needs attention</Text>
              <BackupNotice status={overview.backupStatus} />

              <View style={styles.listBlock}>
                <View style={styles.blockHeading}>
                  <Text style={text.bodyStrong}>Low stock</Text>
                  <LinkText label="Stock report" onPress={() => router.push('/reports/stock')} />
                </View>
                {overview.lowStock.length === 0 ? (
                  <Text style={text.meta}>Every active item is above its low-stock level.</Text>
                ) : overview.lowStock.slice(0, 6).map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="link"
                    onPress={() => router.push({ pathname: '/inventory/item/[item-id]', params: { 'item-id': item.id } })}
                    style={({ pressed }) => [styles.lineRow, pressed ? styles.pressed : null]}
                  >
                    <Text numberOfLines={1} style={[text.body, styles.lineLabel]}>{item.name}</Text>
                    <Text style={[text.amount, styles.lowStockValue]}>{item.currentStock} {item.unitLabel} left</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.listBlock}>
                <View style={styles.blockHeading}>
                  <Text style={text.bodyStrong}>Statements with no payment yet</Text>
                  <LinkText label="Collections" onPress={() => router.push('/reports/collections')} />
                </View>
                {overview.awaitingPayment.length === 0 ? (
                  <Text style={text.meta}>Every finalized statement has a payment recorded.</Text>
                ) : overview.awaitingPayment.slice(0, 6).map((statement) => (
                  <Pressable
                    key={statement.id}
                    accessibilityRole="link"
                    onPress={() => router.push({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': statement.id } })}
                    style={({ pressed }) => [styles.lineRow, pressed ? styles.pressed : null]}
                  >
                    <View style={styles.lineLabel}>
                      <Text numberOfLines={1} style={text.body}>{statement.customerName}</Text>
                      <Text style={text.meta}>{statement.bsNumber} · {formatDisplayDate(statement.businessDate)}</Text>
                    </View>
                    <Text style={text.amount}>{formatCentavos(statement.totalCentavos)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>

          {width < 600 ? (
            <View style={styles.phoneLinks}>
              {PHONE_LINKS.map((link) => (
                <ActionButton key={link.label} variant="secondary" onPress={() => router.push(link.href)}>{link.label}</ActionButton>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

function Figure({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.figure}>
      <Text style={text.meta}>{label}</Text>
      <Text style={[styles.figureValue, warn ? styles.figureWarn : null]}>{value}</Text>
    </View>
  );
}

function LinkText({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" hitSlop={10} onPress={onPress}>
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

function BackupNotice({ status }: { status: BackupStatus }) {
  const lastExport = status.lastExport
    ? formatDisplayDate(getLocalBusinessDate(new Date(status.lastExport.createdAt)))
    : null;
  if (!status.noticeDue) {
    return (
      <View style={styles.listBlock}>
        <View style={styles.blockHeading}>
          <Text style={text.bodyStrong}>Backup</Text>
          <LinkText label="Open backup" onPress={() => router.push('/backup')} />
        </View>
        <Text style={text.meta}>{lastExport ? `Last exported ${lastExport}.` : 'No backup has been exported yet.'}</Text>
      </View>
    );
  }
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeTitle}>Backup is due</Text>
      <Text style={styles.noticeBody}>
        {status.revisionsNotExported} change{status.revisionsNotExported === 1 ? '' : 's'} since the last backup
        {lastExport ? ` on ${lastExport}` : ''}.
      </Text>
      <ActionButton compact variant="secondary" onPress={() => router.push('/backup')} style={styles.noticeButton}>Back up now</ActionButton>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xxl, paddingBottom: 48, gap: spacing.xl },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.lg },
  headerTitle: { flexGrow: 1, flexBasis: 220 },
  search: {
    flexGrow: 1,
    flexBasis: 280,
    maxWidth: 420,
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    color: colors.label,
    fontSize: fontSize.body,
  },
  loading: { marginTop: spacing.xxl },
  figures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: radius.panel,
  },
  figure: { flexGrow: 1, flexBasis: 140, paddingVertical: 14, paddingHorizontal: spacing.xl, gap: 2 },
  figureValue: { color: colors.label, fontSize: fontSize.section, fontWeight: '600', fontVariant: ['tabular-nums'] },
  figureWarn: { color: colors.error },
  columns: { gap: spacing.xxl },
  columnsWide: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { gap: spacing.md },
  mainColumn: { flex: 3, minWidth: 0 },
  sideColumn: { flex: 2, minWidth: 0 },
  sectionHeading: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  empty: { maxWidth: 520 },
  panel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: radius.panel,
    overflow: 'hidden',
  },
  draftRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.hairline },
  draftKind: { width: 116 },
  draftCopy: { flex: 1, minWidth: 0 },
  chevron: { color: colors.secondaryLabel, fontSize: fontSize.section },
  pressed: { backgroundColor: colors.subtleSurface },
  listBlock: { gap: 6 },
  blockHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm },
  link: { color: colors.primary, fontSize: fontSize.meta, fontWeight: '600' },
  lineRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  lineLabel: { flex: 1, minWidth: 0 },
  lowStockValue: { color: colors.error },
  notice: {
    gap: 6,
    padding: spacing.lg,
    backgroundColor: colors.warningTint,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radius.panel,
  },
  noticeTitle: { color: colors.warning, fontSize: fontSize.body, fontWeight: '600' },
  noticeBody: { color: colors.warning, fontSize: fontSize.meta, lineHeight: 18 },
  noticeButton: { alignSelf: 'flex-start', marginTop: spacing.xs },
  phoneLinks: { gap: spacing.sm },
});
