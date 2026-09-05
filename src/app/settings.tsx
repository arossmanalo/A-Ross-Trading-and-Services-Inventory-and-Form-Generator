import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import {
  getBusinessSettings,
  updateBusinessSettings,
} from '@/features/settings/settings-repository';
import { colors } from '@/theme/colors';

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const [businessName, setBusinessName] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [contactDetails, setContactDetails] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [lowStockNotificationsEnabled, setLowStockNotificationsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void getBusinessSettings(db)
      .then((settings) => {
        setBusinessName(settings.businessName);
        setBusinessAddress(settings.businessAddress);
        setContactDetails(settings.contactDetails);
        setOwnerName(settings.ownerName);
        setLowStockNotificationsEnabled(settings.lowStockNotificationsEnabled);
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not load settings.');
      })
      .finally(() => setLoading(false));
  }, [db]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await updateBusinessSettings(db, {
        businessName,
        businessAddress,
        contactDetails,
        ownerName,
        lowStockNotificationsEnabled,
      });
      setNotice('Settings saved. Future finalized documents will use this identity.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }, [businessAddress, businessName, contactDetails, db, lowStockNotificationsEnabled, ownerName]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.brandBlue} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.intro}>
          <Text selectable style={styles.eyebrow}>BUSINESS IDENTITY</Text>
          <Text selectable style={styles.introText}>
            These values will be snapshotted into future finalized documents. Existing documents will not change.
          </Text>
        </View>

        <FormField autoCapitalize="words" label="Business name" onChangeText={setBusinessName} value={businessName} />
        <FormField
          autoCapitalize="words"
          label="Business address"
          multiline
          onChangeText={setBusinessAddress}
          placeholder="Confirm the active address before PDF sign-off"
          style={styles.multiline}
          textAlignVertical="top"
          value={businessAddress}
        />
        <FormField
          label="Contact details"
          multiline
          onChangeText={setContactDetails}
          placeholder="Phone, email, or other contact lines"
          style={styles.multiline}
          textAlignVertical="top"
          value={contactDetails}
        />
        <FormField autoCapitalize="words" label="Owner / serviced by" onChangeText={setOwnerName} value={ownerName} />

        <View style={styles.settingCard}>
          <View style={styles.settingCopy}>
            <Text selectable style={styles.settingTitle}>Low-stock notifications</Text>
            <Text selectable style={styles.settingDescription}>
              Disable notices without removing thresholds or dashboard low-stock information. Inactive items never notify.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Low-stock notifications"
            onValueChange={setLowStockNotificationsEnabled}
            trackColor={{ false: '#c8ced8', true: '#8ebcf2' }}
            thumbColor={lowStockNotificationsEnabled ? colors.brandBlue : '#f4f4f4'}
            value={lowStockNotificationsEnabled}
          />
        </View>

        {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
        {notice ? <Text selectable style={styles.noticeText}>{notice}</Text> : null}
        <ActionButton disabled={saving} onPress={() => void save()}>
          {saving ? 'Saving…' : 'Save settings'}
        </ActionButton>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { gap: 18, padding: 18, paddingBottom: 44 },
  intro: { gap: 6, padding: 16, backgroundColor: '#eaf2ff', borderRadius: 16, borderCurve: 'continuous' },
  eyebrow: { color: colors.brandBlue, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  introText: { color: colors.brandNavy, fontSize: 14, lineHeight: 20 },
  multiline: { minHeight: 84 },
  settingCard: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 16,
    borderCurve: 'continuous',
  },
  settingCopy: { flex: 1, gap: 4 },
  settingTitle: { color: colors.label, fontSize: 15, fontWeight: '800' },
  settingDescription: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 17 },
  errorText: { color: colors.error, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  noticeText: { color: colors.success, fontSize: 13, lineHeight: 19, fontWeight: '700' },
});
