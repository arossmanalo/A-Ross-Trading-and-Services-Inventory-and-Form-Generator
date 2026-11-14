import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { FormField } from '@/components/form-field';
import { PageBody, PageSection } from '@/components/page-section';
import { ToggleRow } from '@/components/toggle-row';
import { SavedSignatureSettings } from '@/features/signatures/saved-signature-settings';
import { BusinessLogoSettings } from '@/features/settings/business-logo-settings';
import {
  getBusinessSettings,
  updateBusinessSettings,
} from '@/features/settings/settings-repository';
import { colors } from '@/theme/colors';
import { fontSize, spacing, text } from '@/theme/typography';

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
    <PageBody>
      <PageSection
        title="Business identity"
        description="These values will be snapshotted into future finalized documents. Existing documents will not change."
      >
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
          placeholder="One phone or contact detail per line; email is always kept last"
          style={styles.multiline}
          textAlignVertical="top"
          value={contactDetails}
        />
        <FormField autoCapitalize="words" label="Owner / serviced by" onChangeText={setOwnerName} value={ownerName} />
      </PageSection>

      <PageSection title="Document signature and logo" description="Used on documents you finalize from now on.">
        <SavedSignatureSettings />
        <BusinessLogoSettings />
      </PageSection>

      <PageSection title="Notifications">
        <ToggleRow
          title="Low-stock notifications"
          detail="Disable notices without removing thresholds or dashboard low-stock information. Inactive items never notify."
          value={lowStockNotificationsEnabled}
          onValueChange={setLowStockNotificationsEnabled}
        />
      </PageSection>

      <View style={styles.footer}>
        {error ? <Text selectable style={text.error}>{error}</Text> : null}
        {notice ? <Text selectable style={styles.noticeText}>{notice}</Text> : null}
        <ActionButton disabled={saving} style={styles.save} onPress={() => void save()}>
          {saving ? 'Saving…' : 'Save settings'}
        </ActionButton>
      </View>
    </PageBody>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  multiline: { minHeight: 84 },
  footer: { gap: spacing.md },
  save: { alignSelf: 'flex-start', paddingHorizontal: spacing.xxl },
  noticeText: { color: colors.success, fontSize: fontSize.meta, lineHeight: 18, fontWeight: '600' },
});
