import { Suspense } from 'react';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View, useColorScheme } from 'react-native';

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

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <Suspense fallback={<LoadingDatabase />}>
      <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDatabase} useSuspense>
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: colors.background },
            headerTintColor: colors.label,
            headerStyle: { backgroundColor: colors.surface },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Overview' }} />
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
          <Stack.Screen name="service-reports/item-usage/new" options={{ title: 'Add Item Usage', presentation: 'modal' }} />
          <Stack.Screen name="service-reports/void" options={{ title: 'Void CSR', presentation: 'modal' }} />
          <Stack.Screen name="billing-statements/index" options={{ title: 'Billing Statements' }} />
          <Stack.Screen name="billing-statements/new" options={{ title: 'New Statement Draft', presentation: 'modal' }} />
          <Stack.Screen name="billing-statements/[statement-id]" options={{ title: 'Billing Statement' }} />
          <Stack.Screen name="billing-statements/charge/new" options={{ title: 'Add Charge', presentation: 'modal' }} />
          <Stack.Screen name="billing-statements/void" options={{ title: 'Void Statement', presentation: 'modal' }} />
          <Stack.Screen name="billing-statements/finalize" options={{ title: 'Finalize Statement', presentation: 'modal' }} />
          <Stack.Screen name="payments/index" options={{ title: 'Payments' }} />
          <Stack.Screen name="payments/new" options={{ title: 'Record Payment', presentation: 'modal' }} />
          <Stack.Screen name="payments/[payment-id]" options={{ title: 'Payment Acknowledgment' }} />
          <Stack.Screen name="payments/void" options={{ title: 'Void Payment', presentation: 'modal' }} />
          <Stack.Screen name="signatures/manage" options={{ title: 'Signing & Returned Files' }} />
        </Stack>
      </SQLiteProvider>
    </Suspense>
  );
}

const styles = StyleSheet.create({
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
