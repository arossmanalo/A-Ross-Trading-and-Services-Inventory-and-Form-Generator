import { Suspense, useEffect } from 'react';
import { requireOptionalNativeModule } from 'expo';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { SheetFrame } from '@/components/sheet-frame';
import { SideMenu } from '@/components/side-menu';
import { migrateDatabase } from '@/db/migrations';
import { DATABASE_NAME } from '@/db/schema';
import { colors } from '@/theme/colors';
import { fontSize } from '@/theme/typography';

/** Form screens open as a panel over the screen they came from. */
const SHEET = { presentation: 'transparentModal', headerShown: false, animation: 'fade' } as const;

/** Below this width the side menu shrinks to a rail; phones get no menu. */
const FULL_MENU_MIN_WIDTH = 1000;
const RAIL_MIN_WIDTH = 600;

function LoadingDatabase() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.brandBlue} />
      <Text selectable style={styles.loadingText}>Preparing the offline database…</Text>
    </View>
  );
}

type NavigationBarModule = typeof import('expo-navigation-bar');

/**
 * Metro reports an error thrown while a module initialises as fatal even when
 * the caller catches it, so a missing native module cannot be guarded with
 * try/catch around require(). Builds made before expo-navigation-bar was added
 * do not contain its native code; probing for it first (which never throws)
 * keeps those builds, and over-the-air updates delivered to them, from crashing.
 */
function loadNavigationBar(): NavigationBarModule | null {
  if (!requireOptionalNativeModule('ExpoNavigationBar')) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-navigation-bar') as NavigationBarModule;
}

/** Keeps the Android system bars hidden so the app always runs full screen. */
function useImmersiveMode() {
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const navigationBar = loadNavigationBar();
    if (!navigationBar) return undefined;
    const hide = () => { void navigationBar.setVisibilityAsync('hidden').catch(() => undefined); };
    hide();
    // A swipe from the edge shows the bar briefly; hide it again afterwards.
    const subscription = navigationBar.addVisibilityListener(({ visibility }) => {
      if (visibility === 'visible') setTimeout(hide, 2500);
    });
    return () => subscription.remove();
  }, []);
}

export default function RootLayout() {
  const { width } = useWindowDimensions();
  useImmersiveMode();

  return (
    <Suspense fallback={<LoadingDatabase />}>
      <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDatabase} useSuspense>
        <View style={styles.appShell}>
          <StatusBar hidden style="dark" />
          {width >= RAIL_MIN_WIDTH ? <SideMenu compact={width < FULL_MENU_MIN_WIDTH} /> : null}
          <View style={styles.stack}>
          <Stack
            screenOptions={{
              contentStyle: {
                // No fixed width: the native stack sizes itself, so the layout
                // follows rotation instead of keeping the old orientation's width.
                flex: 1,
                backgroundColor: colors.background,
              },
              headerTintColor: colors.label,
              headerTitleStyle: { fontSize: fontSize.section, fontWeight: '600', color: colors.label },
              headerStyle: { backgroundColor: colors.surface },
              headerShadowVisible: false,
            }}
            screenLayout={({ children, options, navigation }) => (
              options.presentation === 'transparentModal' ? (
                <SheetFrame title={typeof options.title === 'string' ? options.title : ''} onClose={() => navigation.goBack()}>
                  {children}
                </SheetFrame>
              ) : children
            )}
          >
          <Stack.Screen name="index" options={{ title: 'Overview', headerShown: false }} />
          <Stack.Screen name="backup" options={{ title: 'Backup' }} />
          <Stack.Screen name="search" options={{ title: 'Search' }} />
          <Stack.Screen name="reports/index" options={{ title: 'Financial reports', animation: 'none' }} />
          <Stack.Screen name="reports/stock" options={{ title: 'Stock report', animation: 'none' }} />
          <Stack.Screen name="reports/movements" options={{ title: 'Movement report', animation: 'none' }} />
          <Stack.Screen name="reports/audit" options={{ title: 'Audit report', animation: 'none' }} />
          <Stack.Screen name="reports/collections" options={{ title: 'Collections report', animation: 'none' }} />
          <Stack.Screen name="reports/sales" options={{ title: 'Sales report', animation: 'none' }} />
          <Stack.Screen name="inventory/index" options={{ title: 'Inventory' }} />
          <Stack.Screen
            name="inventory/new"
            options={{ title: 'New inventory item', ...SHEET }}
          />
          <Stack.Screen name="inventory/item/[item-id]/index" options={{ title: 'Inventory item' }} />
          <Stack.Screen
            name="inventory/item/[item-id]/movement"
            options={{ title: 'Stock movement', ...SHEET }}
          />
          <Stack.Screen name="customers/index" options={{ title: 'Customers' }} />
          <Stack.Screen
            name="customers/new"
            options={{ title: 'New customer', ...SHEET }}
          />
          <Stack.Screen
            name="customers/edit"
            options={{ title: 'Edit customer', ...SHEET }}
          />
          <Stack.Screen
            name="customers/equipment/edit"
            options={{ title: 'Edit equipment', ...SHEET }}
          />
          <Stack.Screen name="customers/[customer-id]" options={{ title: 'Customer' }} />
          <Stack.Screen
            name="customers/[customer-id]/pricing"
            options={{ title: 'Customer pricing' }}
          />
          <Stack.Screen
            name="customers/equipment/new"
            options={{ title: 'New equipment', ...SHEET }}
          />
          <Stack.Screen
            name="customers/pricing/new"
            options={{ title: 'Set customer price', ...SHEET }}
          />
          <Stack.Screen name="services/index" options={{ title: 'Services' }} />
          <Stack.Screen
            name="services/new"
            options={{ title: 'New service', ...SHEET }}
          />
          <Stack.Screen name="services/[service-id]" options={{ title: 'Service' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="service-reports/index" options={{ title: 'Service Reports' }} />
          <Stack.Screen name="service-reports/new" options={{ title: 'New CSR Draft', ...SHEET }} />
          <Stack.Screen name="service-reports/[report-id]" options={{ title: 'CSR' }} />
          <Stack.Screen name="service-reports/preview" options={{ title: 'CSR PDF Preview' }} />
          <Stack.Screen name="service-reports/item-usage/new" options={{ title: 'Add Item Usage', ...SHEET }} />
          <Stack.Screen name="service-reports/machine-services" options={{ title: 'Services by machine' }} />
          <Stack.Screen name="service-reports/void" options={{ title: 'Void CSR', ...SHEET }} />
          <Stack.Screen name="quotations/index" options={{ title: 'Quotations' }} />
          <Stack.Screen name="quotations/new" options={{ title: 'New Quotation Draft', ...SHEET }} />
          <Stack.Screen name="quotations/[quotation-id]" options={{ title: 'Quotation' }} />
          <Stack.Screen name="quotations/preview" options={{ title: 'Quotation Preview' }} />
          <Stack.Screen name="quotations/charge/new" options={{ title: 'Add to Quotation', ...SHEET }} />
          <Stack.Screen name="quotations/convert" options={{ title: 'Convert Quotation', ...SHEET }} />
          <Stack.Screen name="quotations/void" options={{ title: 'Void Quotation', ...SHEET }} />
          <Stack.Screen name="deliveries/index" options={{ title: 'Delivery Forms' }} />
          <Stack.Screen name="deliveries/new" options={{ title: 'New Delivery Draft', ...SHEET }} />
          <Stack.Screen name="deliveries/[delivery-id]" options={{ title: 'Delivery Form' }} />
          <Stack.Screen name="deliveries/preview" options={{ title: 'Delivery Form Preview' }} />
          <Stack.Screen name="deliveries/item/new" options={{ title: 'Add Item to Delivery', ...SHEET }} />
          <Stack.Screen name="deliveries/void" options={{ title: 'Void Delivery', ...SHEET }} />
          <Stack.Screen name="billing-statements/index" options={{ title: 'Billing Statements' }} />
          <Stack.Screen name="billing-statements/new" options={{ title: 'New Statement Draft', ...SHEET }} />
          <Stack.Screen name="billing-statements/[statement-id]" options={{ title: 'Billing Statement' }} />
          <Stack.Screen name="billing-statements/preview" options={{ title: 'Billing Statement Preview' }} />
          <Stack.Screen name="billing-statements/charge/new" options={{ title: 'Add Charge', ...SHEET }} />
          <Stack.Screen name="billing-statements/void" options={{ title: 'Void Statement', ...SHEET }} />
          <Stack.Screen name="billing-statements/finalize" options={{ title: 'Finalize Statement', ...SHEET }} />
          <Stack.Screen name="payments/index" options={{ title: 'Payments' }} />
          <Stack.Screen name="payments/new" options={{ title: 'Record Payment', ...SHEET }} />
          <Stack.Screen name="payments/[payment-id]" options={{ title: 'Payment Acknowledgment' }} />
          <Stack.Screen name="payments/void" options={{ title: 'Void Payment', ...SHEET }} />
          <Stack.Screen name="signatures/manage" options={{ title: 'Document Signing' }} />
          <Stack.Screen name="signatures/capture" options={{ title: 'Draw signature', ...SHEET }} />
          </Stack>
          </View>
        </View>
      </SQLiteProvider>
    </Suspense>
  );
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.background,
  },
  stack: {
    flex: 1,
    minWidth: 0,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: colors.background,
    padding: 24,
  },
  loadingText: {
    color: colors.secondaryLabel,
    fontSize: 15,
  },
});
