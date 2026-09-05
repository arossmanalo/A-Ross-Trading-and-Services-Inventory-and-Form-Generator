import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { getBackupStatus, shareBackupPackage, type BackupStatus } from '@/features/backup/backup-repository';
import { colors } from '@/theme/colors';

export default function BackupScreen() {
  const db = useSQLiteContext();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setStatus(await getBackupStatus(db));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load backup status.');
    }
  }, [db]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const exportBackup = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await shareBackupPackage(db);
      setMessage(`${result.filename} was created. Use the share sheet to place it in your private Google Drive.`);
      setStatus(await getBackupStatus(db));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Backup export failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 18, gap: 16, paddingBottom: 44 }}>
      <View style={{ padding: 16, gap: 8, borderRadius: 12, backgroundColor: colors.surface }}>
        <Text selectable style={{ color: colors.label, fontSize: 18, fontWeight: '800' }}>Backup status</Text>
        <Text selectable style={{ color: colors.secondaryLabel }}>
          The app creates one .arossbackup file, then opens Android sharing so you can manually upload it to private Google Drive.
        </Text>
      </View>

      <View style={{ padding: 16, gap: 8, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.warning }}>
        <Text selectable style={{ color: colors.warning, fontWeight: '800' }}>Unencrypted backup</Text>
        <Text selectable style={{ color: colors.secondaryLabel }}>
          Backup files may contain customer information, signatures, and returned signed PDFs. Store them only in a private Drive location.
        </Text>
      </View>

      {status ? (
        <View style={{ padding: 16, gap: 8, borderRadius: 12, backgroundColor: colors.surface }}>
          <Text selectable style={{ color: colors.label, fontWeight: '800' }}>Revision {status.currentRevision}</Text>
          <Text selectable style={{ color: colors.secondaryLabel }}>
            {status.revisionsNotExported === 0 ? 'All recorded revisions are included in the latest export.' : `${status.revisionsNotExported} revision(s) are not included in the latest export.`}
          </Text>
          <Text selectable style={{ color: status.noticeDue ? colors.warning : colors.secondaryLabel }}>
            {status.noticeDue ? 'Seven-day backup notice: export and upload a new backup.' : 'No seven-day backup notice is due.'}
          </Text>
          <Text selectable style={{ color: colors.secondaryLabel }}>
            Finalized records: {status.finalizedRecordCount}
          </Text>
          {status.lastExport ? (
            <Text selectable style={{ color: colors.secondaryLabel }}>
              Last export: {status.lastExport.filename} at revision {status.lastExport.highestRevision}
            </Text>
          ) : (
            <Text selectable style={{ color: colors.secondaryLabel }}>No backup has been exported yet.</Text>
          )}
        </View>
      ) : null}

      <ActionButton disabled={busy} onPress={() => void exportBackup()}>
        {busy ? 'Creating backup...' : 'Create and share backup'}
      </ActionButton>
      {message ? <Text selectable style={{ color: colors.success }}>{message}</Text> : null}
      {error ? <Text selectable style={{ color: colors.error }}>{error}</Text> : null}
    </ScrollView>
  );
}
