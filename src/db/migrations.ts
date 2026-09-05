import type { SQLiteDatabase } from 'expo-sqlite';

import { DATABASE_VERSION, SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5 } from '@/db/schema';

type UserVersionRow = { user_version: number };

export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

  const row = await db.getFirstAsync<UserVersionRow>('PRAGMA user_version');
  const currentVersion = row?.user_version ?? 0;

  if (currentVersion > DATABASE_VERSION) {
    throw new Error(
      `Database version ${currentVersion} is newer than supported version ${DATABASE_VERSION}.`,
    );
  }

  if (currentVersion < 1) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(SCHEMA_V1);
      await tx.runAsync(
        'INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)',
        'database_revision',
        '0',
      );
      await tx.runAsync(
        "INSERT OR IGNORE INTO sequences (name, high_water_mark) VALUES ('CSR', 0), ('BS', 0), ('PA', 0)",
      );
      await tx.execAsync('PRAGMA user_version = 1;');
    });
  }

  if (currentVersion < 2) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(SCHEMA_V2);
      await tx.execAsync('PRAGMA user_version = 2;');
    });
  }

  if (currentVersion < 3) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(SCHEMA_V3);
      await tx.execAsync('PRAGMA user_version = 3;');
    });
  }

  if (currentVersion < 4) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(SCHEMA_V4);
      await tx.execAsync('PRAGMA user_version = 4;');
    });
  }

  if (currentVersion < 5) {
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(SCHEMA_V5);
      await tx.execAsync('PRAGMA user_version = 5;');
    });
  }

  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT OR IGNORE INTO settings
      (id, business_name, business_address, contact_details, owner_name,
       low_stock_notifications_enabled, app_lock_enabled, created_at, updated_at)
     VALUES ('business', 'A.Ross Trading and Services', '', '', '', 1, 0, ?, ?)`,
    now,
    now,
  );
}
