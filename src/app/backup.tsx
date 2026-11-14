import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/action-button';
import { PageBody, PageNote, PageSection } from '@/components/page-section';
import { Fact, Panel } from '@/components/record-layout';
import { StatusChip } from '@/components/status-chip';
import { readBackupFile, restoreBackupPackage, type BackupRestoreResult } from '@/features/backup/backup-restore';
import { getBackupStatus, shareBackupPackage, type BackupStatus } from '@/features/backup/backup-repository';
import { colors } from '@/theme/colors';
import { fontSize, spacing, text } from '@/theme/typography';

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

  const restoreBackup = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw new Error('No backup file was selected.');
      if (!asset.name.toLowerCase().endsWith('.arossbackup')) throw new Error('Select an .arossbackup file.');
      const bytes = await readBackupFile(asset.uri);
      const confirmed = await new Promise<boolean>(resolve => {
        Alert.alert(
          'Replace local data?',
          'This validates the backup, creates a safety export when local records exist, then replaces all local records. This cannot be undone from the app.',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Validate and restore', style: 'destructive', onPress: () => resolve(true) },
          ],
          { onDismiss: () => resolve(false) },
        );
      });
      if (!confirmed) return;
      const restored: BackupRestoreResult = await restoreBackupPackage(db, bytes, asset.name);
      setMessage(`${restored.filename} restored through revision ${restored.highestRevision}. ${restored.restoredExternalAssetCount} signed file(s) restored.${restored.safetyExportFilename ? ` Safety export: ${restored.safetyExportFilename}` : ''}`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Backup restore failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageBody>
      <PageSection
        title="Backup status"
        description="The app creates one .arossbackup file, then opens Android sharing so you can manually upload it to private Google Drive."
      >
        {status ? (
          <Panel>
            <View style={styles.statusHead}>
              <Text selectable style={[text.subhead, styles.tabular]}>Revision {status.currentRevision}</Text>
              {status.noticeDue ? <StatusChip tone="draft" label="Backup due" /> : <StatusChip tone="final" label="Up to date" />}
            </View>
            <View style={styles.facts}>
              <Fact label="Latest export">
                {status.revisionsNotExported === 0
                  ? 'All recorded revisions are included in the latest export.'
                  : `${status.revisionsNotExported} revision(s) are not included in the latest export.`}
              </Fact>
              <Fact label="Seven-day notice">
                {status.noticeDue ? 'Seven-day backup notice: export and upload a new backup.' : 'No seven-day backup notice is due.'}
              </Fact>
              <Fact label="Finalized records">{String(status.finalizedRecordCount)}</Fact>
              <Fact label="Last export">
                {status.lastExport
                  ? `${status.lastExport.filename} at revision ${status.lastExport.highestRevision}`
                  : 'No backup has been exported yet.'}
              </Fact>
            </View>
          </Panel>
        ) : null}
        <PageNote tone="warning" title="Unencrypted backup">
          Backup files may contain customer information, signatures, and returned signed PDFs. Store them only in a private Drive location.
        </PageNote>
        <View style={styles.actions}>
          <ActionButton disabled={busy} onPress={() => void exportBackup()}>
            {busy ? 'Creating backup…' : 'Create and share backup'}
          </ActionButton>
          <ActionButton disabled={busy} variant="secondary" onPress={() => void restoreBackup()}>
            {busy ? 'Working…' : 'Validate and restore backup'}
          </ActionButton>
        </View>
        {message ? <Text selectable style={styles.message}>{message}</Text> : null}
        {error ? <Text selectable style={text.error}>{error}</Text> : null}
      </PageSection>
    </PageBody>
  );
}

const styles = StyleSheet.create({
  statusHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  tabular: { fontVariant: ['tabular-nums'] },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, padding: spacing.lg },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  message: { color: colors.success, fontSize: fontSize.meta, lineHeight: 18, fontWeight: '600' },
});
