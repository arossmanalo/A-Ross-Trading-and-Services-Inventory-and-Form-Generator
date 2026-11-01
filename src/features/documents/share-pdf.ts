import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

/**
 * Android names a shared file after the file on disk, so the PDF is copied
 * into the cache under its display name first. Stored PDFs keep their own
 * names, which the database and backups rely on.
 */
export async function sharePdfFile(input: { sourceUri: string; fileName: string; dialogTitle?: string }): Promise<void> {
  if (!FileSystem.cacheDirectory) throw new Error('Temporary storage is unavailable on this device.');
  if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable on this device.');
  const directory = `${FileSystem.cacheDirectory}shared-pdfs/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const target = `${directory}${input.fileName}`;
  await FileSystem.deleteAsync(target, { idempotent: true });
  await FileSystem.copyAsync({ from: input.sourceUri, to: target });
  await Sharing.shareAsync(target, {
    dialogTitle: input.dialogTitle ?? `Share ${input.fileName}`,
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
  });
}
