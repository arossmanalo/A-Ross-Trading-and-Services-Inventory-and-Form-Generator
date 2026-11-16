import { Image } from 'expo-image';
import { router, usePathname, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getMenuBadges, hidesSideMenu, type MenuBadges } from '@/features/navigation/menu-badges';

import { colors } from '@/theme/colors';
import { fontSize, radius } from '@/theme/typography';

type MenuItem = { label: string; short: string; href: Href; section: string };
type MenuGroup = { label: string; items: MenuItem[] };

const GROUPS: MenuGroup[] = [
  {
    label: 'Work',
    items: [
      { label: 'Overview', short: 'Home', href: '/', section: '' },
      { label: 'Service reports', short: 'CSRs', href: '/service-reports', section: 'service-reports' },
      { label: 'Quotations', short: 'Quotes', href: '/quotations', section: 'quotations' },
      { label: 'Deliveries', short: 'Deliver', href: '/deliveries', section: 'deliveries' },
      { label: 'Billing statements', short: 'Billing', href: '/billing-statements', section: 'billing-statements' },
      { label: 'Payments', short: 'Paid', href: '/payments', section: 'payments' },
    ],
  },
  {
    label: 'Records',
    items: [
      { label: 'Customers', short: 'Clients', href: '/customers', section: 'customers' },
      { label: 'Inventory', short: 'Stock', href: '/inventory', section: 'inventory' },
      { label: 'Service catalog', short: 'Services', href: '/services', section: 'services' },
    ],
  },
  {
    label: 'Office',
    items: [
      { label: 'Search', short: 'Search', href: '/search', section: 'search' },
      { label: 'Reports', short: 'Reports', href: '/reports', section: 'reports' },
      { label: 'Backup', short: 'Backup', href: '/backup', section: 'backup' },
      { label: 'Settings', short: 'Settings', href: '/settings', section: 'settings' },
    ],
  },
];

/** The first path segment, which names the section a screen belongs to. */
export function sectionOf(pathname: string): string {
  return pathname.split('/').filter(Boolean)[0] ?? '';
}

/** The badge beside a section: its open drafts, or "!" when a backup is due. */
function badgeFor(section: string, badges: MenuBadges | null): string | null {
  if (!badges) return null;
  const count = {
    'service-reports': badges.serviceReportDrafts,
    quotations: badges.quotationDrafts,
    deliveries: badges.deliveryDrafts,
    'billing-statements': badges.statementDrafts,
  }[section];
  if (count) return String(count);
  if (section === 'backup' && badges.backupDue) return '!';
  return null;
}

function badgeLabel(section: string, badge: string): string {
  return section === 'backup' ? 'backup due' : `${badge} open draft${badge === '1' ? '' : 's'}`;
}

/** Re-reads the badges whenever the screen changes, since drafts are created and finalized on other screens. */
function useMenuBadges(pathname: string): MenuBadges | null {
  const db = useSQLiteContext();
  const [badges, setBadges] = useState<MenuBadges | null>(null);
  const request = useRef(0);

  useEffect(() => {
    const current = ++request.current;
    getMenuBadges(db)
      .then((next) => { if (current === request.current) setBadges(next); })
      // Badges are only a hint: hide them rather than show stale counts. Each section reports its own load errors.
      .catch(() => { if (current === request.current) setBadges(null); });
  }, [db, pathname]);

  return badges;
}

/** Opens a section from the menu: back from it always returns to the Overview. */
function openSection(item: MenuItem) {
  if (router.canDismiss()) router.dismissAll();
  if (item.section !== '') router.push(item.href);
}

type SideMenuProps = { compact: boolean };

/** Fixed navigation beside every screen; `compact` is the narrow portrait rail. */
export function SideMenu({ compact }: SideMenuProps) {
  const pathname = usePathname();
  const currentSection = sectionOf(pathname);
  const badges = useMenuBadges(pathname);

  if (hidesSideMenu(pathname)) return null;

  return (
    <View style={[styles.menu, compact ? styles.rail : styles.full]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, compact ? styles.railContent : null]}>
        <View style={[styles.brand, compact ? styles.brandRail : null]}>
          <View style={styles.logoTile}>
            <Image
              accessibilityLabel="A.Ross Trading and Services"
              contentFit="contain"
              source={require('../../assets/a-ross-logo.png')}
              style={styles.logo}
            />
          </View>
          {compact ? null : (
            <View>
              <Text style={styles.brandName}>A.Ross</Text>
              <Text style={styles.brandSub}>Trading &amp; Services</Text>
            </View>
          )}
        </View>
        {GROUPS.map((group) => (
          <View key={group.label} style={styles.group}>
            {compact ? null : <Text style={styles.groupLabel}>{group.label.toUpperCase()}</Text>}
            {group.items.map((item) => {
              const active = item.section === currentSection;
              const badge = badgeFor(item.section, badges);
              return (
                <Pressable
                  key={item.label}
                  accessibilityRole="link"
                  accessibilityLabel={badge ? `${item.label}, ${badgeLabel(item.section, badge)}` : item.label}
                  accessibilityState={{ selected: active }}
                  onPress={() => openSection(item)}
                  style={({ pressed }) => [
                    compact ? styles.railItem : styles.item,
                    active ? styles.itemActive : null,
                    pressed && !active ? styles.itemPressed : null,
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[compact ? styles.railText : styles.itemText, active ? styles.itemTextActive : null]}
                  >
                    {compact ? item.short : item.label}
                  </Text>
                  {badge ? (
                    <View style={[styles.badge, compact ? styles.badgeRail : null, active ? styles.badgeActive : null]}>
                      <Text style={[styles.badgeText, active ? styles.badgeTextActive : null]}>{badge}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
        {compact ? null : <Text style={styles.footer}>Offline · data stays on this tablet</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  menu: { backgroundColor: colors.sidebar },
  full: { width: 256 },
  rail: { width: 84 },
  content: { paddingHorizontal: 12, paddingVertical: 18, gap: 18 },
  railContent: { paddingHorizontal: 6, alignItems: 'stretch' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6 },
  brandRail: { justifyContent: 'center', paddingHorizontal: 0 },
  logoTile: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.panel,
    backgroundColor: colors.surface,
  },
  logo: { width: 38, height: 24 },
  brandName: { color: colors.onPrimary, fontSize: fontSize.body, fontWeight: '600' },
  brandSub: { color: colors.sidebarMuted, fontSize: fontSize.meta },
  group: { gap: 2 },
  groupLabel: {
    paddingHorizontal: 10,
    paddingBottom: 4,
    color: colors.sidebarMuted,
    fontSize: fontSize.meta,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  item: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderRadius: radius.control,
  },
  railItem: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRadius: radius.control,
  },
  itemActive: { backgroundColor: colors.surface },
  itemPressed: { backgroundColor: colors.sidebarBadge },
  itemText: { flex: 1, color: colors.sidebarText, fontSize: fontSize.body },
  railText: { color: colors.sidebarText, fontSize: fontSize.meta, textAlign: 'center' },
  itemTextActive: { color: colors.sidebar, fontWeight: '600' },
  badge: {
    minWidth: 24,
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.control,
    backgroundColor: colors.sidebarBadge,
  },
  badgeRail: { minWidth: 20, paddingHorizontal: 4 },
  badgeActive: { backgroundColor: colors.accentTint },
  badgeText: { color: colors.onPrimary, fontSize: fontSize.meta, fontWeight: '600', fontVariant: ['tabular-nums'] },
  badgeTextActive: { color: colors.sidebar },
  footer: { paddingHorizontal: 10, color: colors.sidebarMuted, fontSize: fontSize.meta },
});
