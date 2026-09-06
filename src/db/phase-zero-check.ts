import type { SQLiteDatabase } from 'expo-sqlite';

const ROLLBACK_SENTINEL = 'PHASE_ZERO_ROLLBACK_SENTINEL';

export type DatabaseSelfCheck = {
  sqliteVersion: string;
  schemaVersion: number;
  rollbackVerified: boolean;
};

export async function runDatabaseSelfCheck(db: SQLiteDatabase): Promise<DatabaseSelfCheck> {
  // Expo's exclusive transaction uses a separate connection, so a temporary
  // table created on `db` is not visible to the transaction connection.
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS phase_zero_rollback_probe (
      id INTEGER PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    DELETE FROM phase_zero_rollback_probe;
  `);

  try {
    try {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await tx.runAsync(
          'INSERT INTO phase_zero_rollback_probe (id, value) VALUES (?, ?)',
          1,
          'must-roll-back',
        );
        throw new Error(ROLLBACK_SENTINEL);
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== ROLLBACK_SENTINEL) {
        throw error;
      }
    }

    const [version, schema, rollbackRow] = await Promise.all([
      db.getFirstAsync<{ sqlite_version: string }>('SELECT sqlite_version() AS sqlite_version'),
      db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'),
      db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM phase_zero_rollback_probe',
      ),
    ]);

    return {
      sqliteVersion: version?.sqlite_version ?? 'unknown',
      schemaVersion: schema?.user_version ?? 0,
      rollbackVerified: rollbackRow?.count === 0,
    };
  } finally {
    await db.execAsync('DROP TABLE IF EXISTS phase_zero_rollback_probe;');
  }
}
