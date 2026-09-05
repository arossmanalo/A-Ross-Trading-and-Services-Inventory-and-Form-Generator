import type { SQLiteDatabase } from 'expo-sqlite';

export type DocumentSequence = 'BS' | 'CSR' | 'PA';

export async function allocateDocumentNumber(
  db: SQLiteDatabase,
  sequence: DocumentSequence,
): Promise<string> {
  const row = await db.getFirstAsync<{ high_water_mark: number }>(
    'SELECT high_water_mark FROM sequences WHERE name = ?',
    sequence,
  );

  if (!row) {
    throw new Error(`Missing ${sequence} sequence.`);
  }

  const nextValue = row.high_water_mark + 1;
  const result = await db.runAsync(
    'UPDATE sequences SET high_water_mark = ? WHERE name = ? AND high_water_mark = ?',
    nextValue,
    sequence,
    row.high_water_mark,
  );

  if (result.changes !== 1) {
    throw new Error(`Could not allocate the next ${sequence} number.`);
  }

  return `${sequence}-${String(nextValue).padStart(6, '0')}`;
}
