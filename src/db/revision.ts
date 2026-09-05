import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

type AuditDetails = Record<string, boolean | number | string | null>;

export async function incrementDatabaseRevision(db: SQLiteDatabase): Promise<void> {
  const result = await db.runAsync(
    `UPDATE app_meta
     SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
     WHERE key = 'database_revision'`,
  );

  if (result.changes !== 1) {
    throw new Error('Database revision marker is missing.');
  }
}

export async function appendAuditEvent(
  db: SQLiteDatabase,
  input: {
    eventType: string;
    entityType: string;
    entityId: string;
    details?: AuditDetails;
    createdAt?: string;
  },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO audit_events
      (id, event_type, entity_type, entity_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    Crypto.randomUUID(),
    input.eventType,
    input.entityType,
    input.entityId,
    JSON.stringify(input.details ?? {}),
    input.createdAt ?? new Date().toISOString(),
  );
}
