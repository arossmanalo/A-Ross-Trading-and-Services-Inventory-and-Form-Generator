import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { memo, useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import {
  getCustomerDetail,
  setCustomerActive,
  setEquipmentActive,
} from '@/features/customers/customer-repository';
import type { CustomerDetail, CustomerEquipment } from '@/features/customers/customer-types';
import { colors } from '@/theme/colors';

const EquipmentCard = memo(function EquipmentCard({
  equipment,
  onToggle,
}: {
  equipment: CustomerEquipment;
  onToggle: (equipment: CustomerEquipment) => void;
}) {
  return (
    <View style={[styles.equipmentCard, !equipment.active ? styles.inactiveCard : null]}>
      <View style={styles.equipmentHeader}>
        <View style={styles.flexCopy}>
          <Text selectable style={styles.equipmentName}>{equipment.machineType}</Text>
          <Text selectable style={styles.equipmentMeta}>
            {[equipment.model, equipment.nicknameOrLocation].filter(Boolean).join(' · ') || 'No model or location'}
          </Text>
        </View>
        <Text selectable style={equipment.active ? styles.activeBadge : styles.inactiveBadge}>
          {equipment.active ? 'ACTIVE' : 'INACTIVE'}
        </Text>
      </View>
      {equipment.serialNumber ? (
        <Text selectable style={styles.detailLine}>Serial: {equipment.serialNumber}</Text>
      ) : null}
      {equipment.notes ? <Text selectable style={styles.detailLine}>{equipment.notes}</Text> : null}
      <ActionButton onPress={() => onToggle(equipment)} variant="secondary">
        {equipment.active ? 'Deactivate equipment' : 'Reactivate equipment'}
      </ActionButton>
    </View>
  );
});

export default function CustomerDetailScreen() {
  const { 'customer-id': customerId } = useLocalSearchParams<{ 'customer-id': string }>();
  const db = useSQLiteContext();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCustomer = useCallback(async () => {
    if (!customerId) {
      setError('Customer identifier is missing.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await getCustomerDetail(db, customerId);
      if (!result) throw new Error('Customer was not found.');
      setCustomer(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the customer.');
    } finally {
      setLoading(false);
    }
  }, [customerId, db]);

  useFocusEffect(
    useCallback(() => {
      void loadCustomer();
    }, [loadCustomer]),
  );

  const addEquipment = useCallback(() => {
    if (!customerId) return;
    router.push({ pathname: '/customers/equipment/new', params: { customerId } });
  }, [customerId]);

  const openPricing = useCallback(() => {
    if (!customerId) return;
    router.push({
      pathname: '/customers/[customer-id]/pricing',
      params: { 'customer-id': customerId },
    });
  }, [customerId]);

  const confirmCustomerToggle = useCallback(() => {
    if (!customer) return;
    const nextActive = !customer.active;
    Alert.alert(
      nextActive ? 'Reactivate customer?' : 'Deactivate customer?',
      nextActive
        ? 'The customer will be available for new service work again.'
        : 'History is preserved, but this customer cannot be selected for new work.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextActive ? 'Reactivate' : 'Deactivate',
          style: nextActive ? 'default' : 'destructive',
          onPress: () => {
            void setCustomerActive(db, customer.id, nextActive)
              .then(loadCustomer)
              .catch((toggleError: unknown) => {
                setError(toggleError instanceof Error ? toggleError.message : 'Could not update customer.');
              });
          },
        },
      ],
    );
  }, [customer, db, loadCustomer]);

  const confirmEquipmentToggle = useCallback((equipment: CustomerEquipment) => {
    const nextActive = !equipment.active;
    Alert.alert(
      nextActive ? 'Reactivate equipment?' : 'Deactivate equipment?',
      'Existing service history will remain unchanged.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextActive ? 'Reactivate' : 'Deactivate',
          style: nextActive ? 'default' : 'destructive',
          onPress: () => {
            void setEquipmentActive(db, equipment.id, nextActive)
              .then(loadCustomer)
              .catch((toggleError: unknown) => {
                setError(toggleError instanceof Error ? toggleError.message : 'Could not update equipment.');
              });
          },
        },
      ],
    );
  }, [db, loadCustomer]);

  if (loading && !customer) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.brandBlue} size="large" />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: customer?.name ?? 'Customer' }} />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        data={customer?.equipment ?? []}
        keyExtractor={getEquipmentKey}
        renderItem={({ item }) => (
          <EquipmentCard equipment={item} onToggle={confirmEquipmentToggle} />
        )}
        ItemSeparatorComponent={EquipmentSeparator}
        refreshing={loading}
        onRefresh={loadCustomer}
        ListHeaderComponent={
          <View style={styles.headerContent}>
            {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
            {customer ? (
              <>
                <View style={styles.profileCard}>
                  <View style={styles.profileHeader}>
                    <Text selectable style={styles.eyebrow}>CUSTOMER PROFILE</Text>
                    <Text selectable style={customer.active ? styles.activeBadge : styles.inactiveBadge}>
                      {customer.active ? 'ACTIVE' : 'INACTIVE'}
                    </Text>
                  </View>
                  <Text selectable style={styles.customerName}>{customer.name}</Text>
                  <Detail label="Address" value={customer.address} />
                  <Detail label="Phone" value={customer.contactNumber} />
                  <Detail label="Email" value={customer.email} />
                  <ActionButton onPress={openPricing}>Customer-specific prices</ActionButton>
                  <ActionButton onPress={confirmCustomerToggle} variant="secondary">
                    {customer.active ? 'Deactivate customer' : 'Reactivate customer'}
                  </ActionButton>
                </View>

                <View style={styles.sectionHeader}>
                  <View style={styles.flexCopy}>
                    <Text selectable style={styles.sectionTitle}>Equipment</Text>
                    <Text selectable style={styles.sectionCaption}>
                      Serial numbers are recorded as entered and are not treated as unique.
                    </Text>
                  </View>
                  {customer.active ? (
                    <ActionButton onPress={addEquipment} compact>
                      Add
                    </ActionButton>
                  ) : null}
                </View>
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          customer ? (
            <View style={styles.emptyEquipment}>
              <Text selectable style={styles.emptyTitle}>No equipment registered</Text>
              <Text selectable style={styles.sectionCaption}>
                Add a machine before creating its first customer service report.
              </Text>
            </View>
          ) : null
        }
      />
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text selectable style={styles.detailLabel}>{label}</Text>
      <Text selectable style={styles.detailValue}>{value || 'Not provided'}</Text>
    </View>
  );
}

function getEquipmentKey(equipment: CustomerEquipment) {
  return equipment.id;
}

function EquipmentSeparator() {
  return <View style={styles.cardGap} />;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  content: {
    padding: 18,
    paddingBottom: 44,
  },
  headerContent: { gap: 24, paddingBottom: 14 },
  profileCard: {
    gap: 14,
    padding: 18,
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderCurve: 'continuous',
    boxShadow: '0 2px 12px rgba(15, 23, 42, 0.07)',
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  eyebrow: {
    color: colors.brandBlue,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  customerName: { color: colors.label, fontSize: 24, fontWeight: '900' },
  detailRow: { gap: 3 },
  detailLabel: {
    color: colors.secondaryLabel,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  detailValue: { color: colors.label, fontSize: 15, lineHeight: 21 },
  activeBadge: {
    color: colors.success,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  inactiveBadge: {
    color: colors.secondaryLabel,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  flexCopy: { flex: 1, gap: 4 },
  sectionTitle: { color: colors.label, fontSize: 19, fontWeight: '900' },
  sectionCaption: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
  equipmentCard: {
    gap: 11,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
    borderRadius: 17,
    borderCurve: 'continuous',
  },
  inactiveCard: { opacity: 0.68 },
  equipmentHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  equipmentName: { color: colors.label, fontSize: 16, fontWeight: '800' },
  equipmentMeta: { color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 },
  detailLine: { color: colors.label, fontSize: 13, lineHeight: 19 },
  cardGap: { height: 12 },
  emptyEquipment: {
    alignItems: 'center',
    gap: 8,
    padding: 30,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 17,
    borderCurve: 'continuous',
  },
  emptyTitle: { color: colors.label, fontSize: 17, fontWeight: '800' },
  errorText: { color: colors.error, fontSize: 13, lineHeight: 19 },
});
