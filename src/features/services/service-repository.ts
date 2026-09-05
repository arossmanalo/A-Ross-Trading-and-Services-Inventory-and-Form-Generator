import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import type { SaveServiceInput, ServiceCatalogEntry } from '@/features/services/service-types';

type ServiceRow = {
  id: string;
  name: string;
  description: string;
  base_rate_centavos: number;
  active: number;
};

export async function listServices(db: SQLiteDatabase): Promise<ServiceCatalogEntry[]> {
  const rows = await db.getAllAsync<ServiceRow>(
    `SELECT id, name, description, base_rate_centavos, active
     FROM services
     ORDER BY active DESC, name COLLATE NOCASE ASC`,
  );
  return rows.map(mapServiceRow);
}

export async function getService(
  db: SQLiteDatabase,
  serviceId: string,
): Promise<ServiceCatalogEntry | null> {
  const row = await db.getFirstAsync<ServiceRow>(
    `SELECT id, name, description, base_rate_centavos, active
     FROM services
     WHERE id = ?`,
    serviceId,
  );
  return row ? mapServiceRow(row) : null;
}

export async function createService(
  db: SQLiteDatabase,
  input: SaveServiceInput,
): Promise<string> {
  const values = validateServiceInput(input);
  const serviceId = Crypto.randomUUID();
  const now = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      `INSERT INTO services
        (id, name, description, base_rate_centavos, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      serviceId,
      values.name,
      values.description,
      values.baseRateCentavos,
      now,
      now,
    );
    await appendAuditEvent(tx, {
      eventType: 'service.created',
      entityType: 'service',
      entityId: serviceId,
      details: { baseRateCentavos: values.baseRateCentavos },
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });

  return serviceId;
}

export async function updateService(
  db: SQLiteDatabase,
  serviceId: string,
  input: SaveServiceInput,
): Promise<void> {
  const values = validateServiceInput(input);
  const now = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (tx) => {
    const existing = await tx.getFirstAsync<{ base_rate_centavos: number }>(
      'SELECT base_rate_centavos FROM services WHERE id = ?',
      serviceId,
    );
    if (!existing) throw new Error('Service was not found.');

    await tx.runAsync(
      `UPDATE services
       SET name = ?, description = ?, base_rate_centavos = ?, updated_at = ?
       WHERE id = ?`,
      values.name,
      values.description,
      values.baseRateCentavos,
      now,
      serviceId,
    );
    await appendAuditEvent(tx, {
      eventType: 'service.updated',
      entityType: 'service',
      entityId: serviceId,
      details: {
        oldBaseRateCentavos: existing.base_rate_centavos,
        newBaseRateCentavos: values.baseRateCentavos,
      },
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });
}

export async function setServiceActive(
  db: SQLiteDatabase,
  serviceId: string,
  active: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const result = await tx.runAsync(
      'UPDATE services SET active = ?, updated_at = ? WHERE id = ?',
      active ? 1 : 0,
      now,
      serviceId,
    );
    if (result.changes !== 1) throw new Error('Service was not found.');

    await appendAuditEvent(tx, {
      eventType: active ? 'service.reactivated' : 'service.deactivated',
      entityType: 'service',
      entityId: serviceId,
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });
}

function validateServiceInput(input: SaveServiceInput) {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Service name is required.');
  if (!Number.isSafeInteger(input.baseRateCentavos) || input.baseRateCentavos < 0) {
    throw new Error('Service rate must be a non-negative amount.');
  }
  return {
    name,
    description: input.description?.trim() ?? '',
    baseRateCentavos: input.baseRateCentavos,
  };
}

function mapServiceRow(row: ServiceRow): ServiceCatalogEntry {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    baseRateCentavos: row.base_rate_centavos,
    active: row.active === 1,
  };
}
