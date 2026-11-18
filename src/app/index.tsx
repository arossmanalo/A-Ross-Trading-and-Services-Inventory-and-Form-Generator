import { router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState, type ReactNode } from 'react';
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
import { listBillingStatements } from '@/features/billing-statements/billing-statement-repository';
import { listRecentCustomers } from '@/features/customers/customer-repository';
import type { RecentCustomer } from '@/features/customers/customer-types';
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
  recentCustomers: RecentCustomer[];
};

/** Customers listed in the Customers panel; the full list is one tap away. */
const RECENT_CUSTOMER_LIMIT = 50;

/** Stands in for an amount while prices are hidden, e.g. when a customer can see the screen. */
const HIDDEN_AMOUNT = '₱ ••••';

type FigureTone = 'accent' | 'good' | 'alert' | 'pending';

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
  { label: 'Supplies', href: '/supplies' },
  { label: 'Products', href: '/products' },
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
  // Hidden on every app start, since the tablet is often in front of customers.
  const [pricesHidden, setPricesHidden] = useState(true);
  const amount = (centavos: number) => (pricesHidden ? HIDDEN_AMOUNT : formatCentavos(centavos));

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
      listRecentCustomers(db, RECENT_CUSTOMER_LIMIT),
    ])
      .then(([summary, serviceReports, quotations, deliveries, statements, items, recentCustomers]) => {
        if (!active) return;
        setOverview({
          activeItems: summary.activeItems,
          lowStockItems: summary.lowStockItems,
          customers: summary.customers,
          recentCustomers,
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
        <ActionButton
          compact
          variant="secondary"
          onPress={() => setPricesHidden((hidden) => !hidden)}
        >
          {pricesHidden ? 'Show prices' : 'Hide prices'}
        </ActionButton>
        <ActionButton compact onPress={() => router.push('/service-reports/new')}>New CSR</ActionButton>
      </View>

      {error ? <Text style={text.error}>{error}</Text> : null}
      {!overview && !error ? <ActivityIndicator color={colors.primary} style={styles.loading} /> : null}

      {overview ? (
        <>
          <View style={styles.figures}>
            <Figure label="Active items" value={overview.activeItems} tone="accent" />
            <Figure label="Low stock" value={overview.lowStockItems} tone={overview.lowStockItems > 0 ? 'alert' : 'good'} />
            <Figure label="Customers" value={overview.customers} tone="accent" />
            <Figure label="Open drafts" value={overview.drafts.length} tone={overview.drafts.length > 0 ? 'pending' : 'good'} />
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
                <ScrollView nestedScrollEnabled style={[styles.panel, styles.draftsPanel]}>
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
                      <Text style={text.amount}>{amount(draft.totalCentavos)}</Text>
                      <Text style={styles.chevron}>›</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>

            <View style={[styles.column, styles.squares, wide ? styles.sideColumn : null]}>
              <Square
                title="Unpaid statements"
                linkLabel="Collections"
                onLink={() => router.push('/reports/collections')}
                empty="Every finalized statement has a payment recorded."
              >
                {overview.awaitingPayment.map((statement, index) => (
                  <SquareRow
                    key={statement.id}
                    first={index === 0}
                    onPress={() => router.push({ pathname: '/billing-statements/[statement-id]', params: { 'statement-id': statement.id } })}
                    title={statement.customerName}
                    meta={`${statement.bsNumber} · ${formatDisplayDate(statement.businessDate)}`}
                    value={amount(statement.totalCentavos)}
                  />
                ))}
              </Square>

              <Square
                title="Customers"
                linkLabel="All customers"
                onLink={() => router.push('/customers')}
                empty="No customer has a CSR, quotation, delivery or statement yet."
              >
                {overview.recentCustomers.map((customer, index) => (
                  <SquareRow
                    key={customer.id}
                    first={index === 0}
                    onPress={() => router.push({ pathname: '/customers/[customer-id]', params: { 'customer-id': customer.id } })}
                    title={customer.name}
                    meta={`Last document ${formatDisplayDate(customer.lastActivityDate)}`}
                  />
                ))}
              </Square>

              <Square
                title="Inventory"
                linkLabel="Stock report"
                onLink={() => router.push('/reports/stock')}
                empty="No active inventory items. Add them from Inventory."
              >
                {overview.stockWatch.map((item, index) => (
                  <SquareRow
                    key={item.id}
                    first={index === 0}
                    onPress={() => router.push({ pathname: '/inventory/item/[item-id]', params: { 'item-id': item.id } })}
                    title={item.name}
                    meta={item.low ? 'At or below its low-stock level' : `Low at ${item.lowStockThreshold} ${item.unitLabel}`}
                    value={`${item.currentStock} ${item.unitLabel} left`}
                    warn={item.low}
                  />
                ))}
              </Square>
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

const FIGURE_TONES: Record<FigureTone, { backgroundColor: string; color: string }> = {
  accent: { backgroundColor: colors.accentTint, color: colors.primary },
  good: { backgroundColor: colors.successTint, color: colors.success },
  alert: { backgroundColor: colors.errorTint, color: colors.error },
  pending: { backgroundColor: colors.warningTint, color: colors.warning },
};

function Figure({ label, value, tone }: { label: string; value: number; tone: FigureTone }) {
  const { backgroundColor, color } = FIGURE_TONES[tone];
  return (
    <View style={[styles.figure, { backgroundColor }]}>
      <Text style={[text.meta, styles.figureLabel]}>{label}</Text>
      <Text style={[styles.figureValue, { color }]}>{value}</Text>
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

/** A titled panel of rows that scrolls inside a fixed height, like the open drafts list. */
function Square({ title, linkLabel, onLink, empty, children }: {
  title: string;
  linkLabel: string;
  onLink: () => void;
  empty: string;
  children: ReactNode[];
}) {
  return (
    <View style={styles.square}>
      <View style={styles.squareHeading}>
        <Text accessibilityRole="header" style={text.section}>{title}</Text>
        <LinkText label={linkLabel} onPress={onLink} />
      </View>
      {children.length === 0 ? (
        <View style={styles.panel}>
          <Text style={[text.meta, styles.squareEmpty]}>{empty}</Text>
        </View>
      ) : (
        <ScrollView nestedScrollEnabled style={[styles.panel, styles.squarePanel]}>
          {children}
        </ScrollView>
      )}
    </View>
  );
}

function SquareRow({ first, onPress, title, meta, value, warn = false }: {
  first: boolean;
  onPress: () => void;
  title: string;
  meta: string;
  value?: string;
  warn?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.squareRow, first ? null : styles.rowDivider, pressed ? styles.pressed : null]}
    >
      <View style={styles.squareCopy}>
        <Text numberOfLines={1} style={text.body}>{title}</Text>
        <Text numberOfLines={1} style={[text.meta, warn ? styles.warnText : null]}>{meta}</Text>
      </View>
      {value ? <Text style={[text.amount, warn ? styles.warnText : null]}>{value}</Text> : null}
    </Pressable>
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
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  figure: {
    flexGrow: 1,
    flexBasis: 140,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    gap: 2,
    borderRadius: radius.panel,
  },
  figureLabel: { color: colors.tertiaryLabel },
  figureValue: { fontSize: fontSize.title, fontWeight: '700', fontVariant: ['tabular-nums'] },
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
  // Fixed heights keep each panel the same size as records pile up; rows scroll inside.
  draftsPanel: { maxHeight: 620 },
  squarePanel: { maxHeight: 250 },
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
  squares: { gap: spacing.xl },
  square: { gap: spacing.md },
  squareHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm },
  link: { color: colors.primary, fontSize: fontSize.meta, fontWeight: '600' },
  squareRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  squareCopy: { flex: 1, minWidth: 0 },
  squareEmpty: { paddingHorizontal: spacing.lg, paddingVertical: 14 },
  warnText: { color: colors.error },
  phoneLinks: { gap: spacing.sm },
});
