import { Suspense, useEffect } from 'react';
import { requireOptionalNativeModule } from 'expo';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Platform, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { migrateDatabase } from '@/db/migrations';
import { DATABASE_NAME } from '@/db/schema';
import { colors } from '@/theme/colors';

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
  const colorScheme = useColorScheme();
  useImmersiveMode();

  return (
    <Suspense fallback={<LoadingDatabase />}>
      <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDatabase} useSuspense>
        <View style={styles.appShell}>
          <StatusBar hidden style={colorScheme === 'dark' ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              contentStyle: {
                // No fixed width: the native stack sizes itself, so the layout
                // follows rotation instead of keeping the old orientation's width.
                flex: 1,
                backgroundColor: colors.background,
              },
              headerTintColor: colors.label,
              headerStyle: { backgroundColor: colors.surface },
              headerShadowVisible: false,
            }}
          >
          <Stack.Screen name="index" options={{ title: 'Overview' }} />
          <Stack.Screen name="backup" options={{ title: 'Backup' }} />
          <Stack.Screen name="search" options={{ title: 'Search' }} />
          <Stack.Screen name="reports/index" options={{ title: 'Financial reports' }} />
          <Stack.Screen name="reports/stock" options={{ title: 'Stock report' }} />
          <Stack.Screen name="reports/movements" options={{ title: 'Movement report' }} />
          <Stack.Screen name="reports/audit" options={{ title: 'Audit report' }} />
          <Stack.Screen name="reports/collections" options={{ title: 'Collections report' }} />
          <Stack.Screen name="reports/sales" options={{ title: 'Sales report' }} />
          <Stack.Screen name="inventory/index" options={{ title: 'Inventory' }} />
          <Stack.Screen
            name="inventory/new"
            options={{ title: 'New inventory item', presentation: 'modal' }}
          />
          <Stack.Screen name="inventory/item/[item-id]/index" options={{ title: 'Inventory item' }} />
          <Stack.Screen
            name="inventory/item/[item-id]/movement"
            options={{ title: 'Stock movement', presentation: 'modal' }}
          />
          <Stack.Screen name="customers/index" options={{ title: 'Customers' }} />
          <Stack.Screen
            name="customers/new"
            options={{ title: 'New customer', presentation: 'modal' }}
          />
          <Stack.Screen
            name="customers/edit"
            options={{ title: 'Edit customer', presentation: 'modal' }}
          />
          <Stack.Screen
            name="customers/equipment/edit"
            options={{ title: 'Edit equipment', presentation: 'modal' }}
          />
          <Stack.Screen name="customers/[customer-id]" options={{ title: 'Customer' }} />
          <Stack.Screen
            name="customers/[customer-id]/pricing"
            options={{ title: 'Customer pricing' }}
          />
          <Stack.Screen
            name="customers/equipment/new"
            options={{ title: 'New equipment', presentation: 'modal' }}
          />
          <Stack.Screen
            name="customers/pricing/new"
            options={{ title: 'Set customer price', presentation: 'modal' }}
          />
          <Stack.Screen name="services/index" options={{ title: 'Services' }} />
          <Stack.Screen
            name="services/new"
            options={{ title: 'New service', presentation: 'modal' }}
          />
          <Stack.Screen name="services/[service-id]" options={{ title: 'Service' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="service-reports/index" options={{ title: 'Service Reports' }} />
          <Stack.Screen name="service-reports/new" options={{ title: 'New CSR Draft', presentation: 'modal' }} />
          <Stack.Screen name="service-reports/[report-id]" options={{ title: 'CSR' }} />
          <Stack.Screen name="service-reports/preview" options={{ title: 'CSR PDF Preview' }} />
          <Stack.Screen name="service-reports/item-usage/new" options={{ title: 'Add Item Usage', presentation: 'modal' }} />
          <Stack.Screen name="service-reports/machine-services" options={{ title: 'Services by machine' }} />
          <Stack.Screen name="service-reports/void" options={{ title: 'Void CSR', presentation: 'modal' }} />
          <Stack.Screen name="quotations/index" options={{ title: 'Quotations' }} />
          <Stack.Screen name="quotations/new" options={{ title: 'New Quotation Draft', presentation: 'modal' }} />
          <Stack.Screen name="quotations/[quotation-id]" options={{ title: 'Quotation' }} />
          <Stack.Screen name="quotations/preview" options={{ title: 'Quotation Preview' }} />
          <Stack.Screen name="quotations/charge/new" options={{ title: 'Add to Quotation', presentation: 'modal' }} />
          <Stack.Screen name="quotations/void" options={{ title: 'Void Quotation', presentation: 'modal' }} />
          <Stack.Screen name="deliveries/index" options={{ title: 'Delivery Forms' }} />
          <Stack.Screen name="deliveries/new" options={{ title: 'New Delivery Draft', presentation: 'modal' }} />
          <Stack.Screen name="deliveries/[delivery-id]" options={{ title: 'Delivery Form' }} />
          <Stack.Screen name="deliveries/preview" options={{ title: 'Delivery Form Preview' }} />
          <Stack.Screen name="deliveries/item/new" options={{ title: 'Add Item to Delivery', presentation: 'modal' }} />
          <Stack.Screen name="deliveries/void" options={{ title: 'Void Delivery', presentation: 'modal' }} />
          <Stack.Screen name="billing-statements/index" options={{ title: 'Billing Statements' }} />
          <Stack.Screen name="billing-statements/new" options={{ title: 'New Statement Draft', presentation: 'modal' }} />
          <Stack.Screen name="billing-statements/[statement-id]" options={{ title: 'Billing Statement' }} />
          <Stack.Screen name="billing-statements/preview" options={{ title: 'Billing Statement Preview' }} />
          <Stack.Screen name="billing-statements/charge/new" options={{ title: 'Add Charge', presentation: 'modal' }} />
          <Stack.Screen name="billing-statements/void" options={{ title: 'Void Statement', presentation: 'modal' }} />
          <Stack.Screen name="billing-statements/finalize" options={{ title: 'Finalize Statement', presentation: 'modal' }} />
          <Stack.Screen name="payments/index" options={{ title: 'Payments' }} />
          <Stack.Screen name="payments/new" options={{ title: 'Record Payment', presentation: 'modal' }} />
          <Stack.Screen name="payments/[payment-id]" options={{ title: 'Payment Acknowledgment' }} />
          <Stack.Screen name="payments/void" options={{ title: 'Void Payment', presentation: 'modal' }} />
          <Stack.Screen name="signatures/manage" options={{ title: 'Document Signing' }} />
          <Stack.Screen name="signatures/capture" options={{ title: 'Draw signature', presentation: 'modal' }} />
          </Stack>
        </View>
      </SQLiteProvider>
    </Suspense>
  );
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1,
    backgroundColor: colors.background,
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
