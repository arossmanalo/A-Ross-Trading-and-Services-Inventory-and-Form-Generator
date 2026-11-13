import { Stack, router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { Panel, RecordHeader, SectionTitle } from '@/components/record-layout';
import { StatusChip } from '@/components/status-chip';
import { getCustomerDetail, setCustomerActive, setEquipmentActive } from '@/features/customers/customer-repository';
import type { CustomerDetail, CustomerEquipment } from '@/features/customers/customer-types';
import { colors } from '@/theme/colors';
import { fontSize, spacing, text } from '@/theme/typography';

type CustomerDetailViewProps = {
  customerId: string;
  embedded?: boolean;
  /** Called after the customer is deactivated or reactivated, so a list can refresh. */
  onChanged?: () => void;
};

export function CustomerDetailView({ customerId, embedded = false, onChanged }: CustomerDetailViewProps) {
  const db = useSQLiteContext();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);

  const loadCustomer = useCallback(async () => {
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

  useFocusEffect(useCallback(() => { void loadCustomer(); }, [loadCustomer]));

  const editEquipment = useCallback((equipment: CustomerEquipment) => {
    router.push(`/customers/equipment/edit?customerId=${encodeURIComponent(customerId)}&equipmentId=${encodeURIComponent(equipment.id)}` as Href);
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
              .then(async () => {
                await loadCustomer();
                onChanged?.();
              })
              .catch((toggleError: unknown) => {
                setError(toggleError instanceof Error ? toggleError.message : 'Could not update customer.');
              });
          },
        },
      ],
    );
  }, [customer, db, loadCustomer, onChanged]);

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

  if (loading && !customer) return <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>;
  if (!customer) return <View style={styles.centered}><Text selectable style={text.error}>{error ?? 'Customer was not found.'}</Text></View>;

  const company = customer.customerType === 'company';
  const twoColumns = company && width >= 860;

  return (
    <>
      {embedded ? null : <Stack.Screen options={{ title: customer.name }} />}
      <ScrollView contentContainerStyle={styles.content} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <RecordHeader
          title={customer.name}
          chips={(
            <>
              <StatusChip label={company ? 'Company' : 'Individual'} tone="neutral" />
              <StatusChip label={customer.active ? 'Active' : 'Inactive'} tone={customer.active ? 'final' : 'neutral'} />
            </>
          )}
          actions={(
            <>
              <ActionButton compact variant={customer.active ? 'danger' : 'secondary'} onPress={confirmCustomerToggle}>
                {customer.active ? 'Deactivate' : 'Reactivate'}
              </ActionButton>
              <ActionButton compact variant="secondary" onPress={() => router.push({ pathname: '/customers/[customer-id]/pricing', params: { 'customer-id': customerId } })}>
                Customer prices
              </ActionButton>
              <ActionButton compact variant="secondary" onPress={() => router.push(`/customers/edit?customerId=${encodeURIComponent(customerId)}` as Href)}>
                Edit customer
              </ActionButton>
            </>
          )}
        />
        {error ? <Text accessibilityLiveRegion="polite" selectable style={text.error}>{error}</Text> : null}

        <View style={styles.facts}>
          <Fact label="Address" value={customer.address} />
          <Fact label="Phone" value={customer.contactNumber} />
          <Fact label="Email" value={customer.email} />
        </View>

        <View style={[styles.columns, twoColumns ? styles.columnsWide : null]}>
          <View style={[styles.column, twoColumns ? styles.mainColumn : null]}>
            <SectionTitle title={`Equipment (${customer.equipment.length})`}>
              {customer.active ? (
                <ActionButton compact variant="secondary" onPress={() => router.push({ pathname: '/customers/equipment/new', params: { customerId } })}>Add equipment</ActionButton>
              ) : null}
            </SectionTitle>
            <Text style={text.meta}>Serial numbers are recorded as entered and are not treated as unique.</Text>
            {customer.equipment.length ? (
              <Panel>
                {customer.equipment.map((equipment, index) => (
                  <View key={equipment.id} style={[styles.row, index > 0 ? styles.rowDivider : null, !equipment.active ? styles.inactiveRow : null]}>
                    <View style={styles.rowCopy}>
                      <View style={styles.rowTitle}>
                        <Text selectable style={text.bodyStrong}>{equipment.machineType}</Text>
                        {!equipment.active ? <StatusChip label="Inactive" tone="neutral" /> : null}
                      </View>
                      <Text selectable style={text.meta}>
                        {[equipment.model && `Model ${equipment.model}`, equipment.serialNumber && `Serial ${equipment.serialNumber}`, equipment.nicknameOrLocation].filter(Boolean).join(' · ') || 'No model or location'}
                      </Text>
                      {equipment.notes ? <Text selectable style={text.meta}>{equipment.notes}</Text> : null}
                    </View>
                    <ActionButton compact variant="secondary" onPress={() => editEquipment(equipment)}>Edit</ActionButton>
                    <Pressable accessibilityRole="button" hitSlop={8} onPress={() => confirmEquipmentToggle(equipment)}>
                      <Text style={equipment.active ? styles.deactivate : styles.reactivate}>{equipment.active ? 'Deactivate' : 'Reactivate'}</Text>
                    </Pressable>
                  </View>
                ))}
              </Panel>
            ) : (
              <Text style={text.meta}>No equipment registered. Add a machine before creating its first customer service report.</Text>
            )}
          </View>

          {company ? (
            <View style={[styles.column, twoColumns ? styles.sideColumn : null]}>
              <SectionTitle title="Company members">
                <ActionButton compact variant="secondary" onPress={() => router.push({ pathname: '/customers/member/new', params: { customerId } })}>Add member</ActionButton>
              </SectionTitle>
              <Text style={text.meta}>Members appear in the CSR "Acknowledged by" choices.</Text>
              {customer.members.length ? customer.members.map((member) => (
                <View key={member.id} style={styles.memberRow}>
                  <Text selectable style={text.bodyStrong}>{member.name}</Text>
                  {member.email ? <Text selectable style={text.meta}>{member.email}</Text> : null}
                </View>
              )) : <Text style={text.meta}>No members registered yet.</Text>}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={text.meta}>{label}</Text>
      <Text selectable style={text.body}>{value || 'Not provided'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  content: { gap: spacing.lg, padding: spacing.xxl, paddingBottom: 48 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xl },
  fact: { flexBasis: 200, flexGrow: 1, gap: 2 },
  columns: { gap: spacing.xxl },
  columnsWide: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { gap: spacing.md },
  mainColumn: { flex: 3, minWidth: 0 },
  sideColumn: { flex: 2, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.hairline },
  inactiveRow: { backgroundColor: colors.subtleSurface },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  deactivate: { color: colors.error, fontSize: fontSize.meta, fontWeight: '600', paddingVertical: 10 },
  reactivate: { color: colors.primary, fontSize: fontSize.meta, fontWeight: '600', paddingVertical: 10 },
  memberRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.separator },
});
