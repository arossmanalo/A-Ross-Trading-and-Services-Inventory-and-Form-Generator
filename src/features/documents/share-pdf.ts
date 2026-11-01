import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { base64ToBytes, bytesToBase64 } from '@/features/backup/zip';
import { mergePdfs } from '@/features/documents/pdf-merge';

/**
 * Android names a shared file after the file on disk, so the PDF is written
 * into the cache under its display name first. Stored PDFs keep their own
 * names, which the database and backups rely on. Several source PDFs are
 * merged, in order, into the one file that is shared.
 */
export async function sharePdfFiles(input: { sourceUris: readonly string[]; fileName: string; dialogTitle?: string }): Promise<void> {
  if (input.sourceUris.length === 0) throw new Error('There is no PDF to send.');
  if (!FileSystem.cacheDirectory) throw new Error('Temporary storage is unavailable on this device.');
  if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable on this device.');
  const directory = `${FileSystem.cacheDirectory}shared-pdfs/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const target = `${directory}${input.fileName}`;
  await FileSystem.deleteAsync(target, { idempotent: true });

  if (input.sourceUris.length === 1) {
    await FileSystem.copyAsync({ from: input.sourceUris[0], to: target });
  } else {
    const parts: Uint8Array[] = [];
    for (const uri of input.sourceUris) {
      parts.push(base64ToBytes(await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })));
    }
    const merged = await mergePdfs(parts);
    await FileSystem.writeAsStringAsync(target, bytesToBase64(merged), { encoding: FileSystem.EncodingType.Base64 });
  }

  await Sharing.shareAsync(target, {
    dialogTitle: input.dialogTitle ?? `Share ${input.fileName}`,
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
  });
}

export function sharePdfFile(input: { sourceUri: string; fileName: string; dialogTitle?: string }): Promise<void> {
  return sharePdfFiles({ sourceUris: [input.sourceUri], fileName: input.fileName, dialogTitle: input.dialogTitle });
}
