import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';

/** The PIN that guards deleting inventory items and setting stock counts. */
export const EDIT_PIN_LENGTH = { min: 4, max: 6 } as const;

export function assertEditPinFormat(pin: string): void {
  if (!new RegExp(`^\\d{${EDIT_PIN_LENGTH.min},${EDIT_PIN_LENGTH.max}}$`).test(pin)) {
    throw new Error(`The PIN must be ${EDIT_PIN_LENGTH.min} to ${EDIT_PIN_LENGTH.max} digits.`);
  }
}

function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

type PinRow = { edit_pin_hash: string | null; edit_pin_salt: string | null };

async function readPin(db: SQLiteDatabase): Promise<PinRow | null> {
  return db.getFirstAsync<PinRow>("SELECT edit_pin_hash, edit_pin_salt FROM settings WHERE id = 'business'");
}

export async function hasEditPin(db: SQLiteDatabase): Promise<boolean> {
  const row = await readPin(db);
  return Boolean(row?.edit_pin_hash && row.edit_pin_salt);
}

/** True when the PIN matches the saved one. False when it does not, or none is saved. */
export async function verifyEditPin(db: SQLiteDatabase, pin: string): Promise<boolean> {
  const row = await readPin(db);
  if (!row?.edit_pin_hash || !row.edit_pin_salt) return false;
  return (await hashPin(pin, row.edit_pin_salt)) === row.edit_pin_hash;
}

/**
 * Saves a new PIN. Callers check the old PIN, or the tablet's own screen lock
 * for a forgotten one, before calling this.
 */
export async function setEditPin(db: SQLiteDatabase, pin: string): Promise<void> {
  assertEditPinFormat(pin);
  const salt = Crypto.randomUUID();
  const hash = await hashPin(pin, salt);
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const result = await tx.runAsync(
      "UPDATE settings SET edit_pin_hash = ?, edit_pin_salt = ?, updated_at = ? WHERE id = 'business'",
      hash,
      salt,
      now,
    );
    if (result.changes !== 1) throw new Error('Business settings were not found.');
    await appendAuditEvent(tx, { eventType: 'settings.edit_pin_set', entityType: 'settings', entityId: 'business', createdAt: now });
    await incrementDatabaseRevision(tx);
  });
}
