import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { assertOptionalEmail, normalizeCustomerName } from '@/domain/customer';
import type {
  CreateCustomerInput,
  CreateEquipmentInput,
  CustomerDetail,
  CustomerEquipment,
  CustomerSummary,
} from '@/features/customers/customer-types';

type CustomerRow = {
  id: string;
  name: string;
  address: string;
  contact_number: string;
  email: string;
  active: number;
  equipment_count: number;
};

type EquipmentRow = {
  id: string;
  customer_id: string;
  machine_type: string;
  model: string;
  serial_number: string;
  nickname_or_location: string;
  notes: string;
  active: number;
};

export class DuplicateCustomerNameError extends Error {
  constructor(readonly customerName: string) {
    super(`A customer named “${customerName}” already exists. Confirm to save another profile.`);
    this.name = 'DuplicateCustomerNameError';
  }
}

export async function listCustomers(db: SQLiteDatabase): Promise<CustomerSummary[]> {
  const rows = await db.getAllAsync<CustomerRow>(
    `SELECT
       c.id,
       c.name,
       c.address,
       c.contact_number,
       c.email,
       c.active,
       COUNT(e.id) AS equipment_count
     FROM customers c
     LEFT JOIN customer_equipment e
       ON e.customer_id = c.id AND e.active = 1
     WHERE c.merged_into_customer_id IS NULL
     GROUP BY c.id
     ORDER BY c.active DESC, c.name COLLATE NOCASE ASC`,
  );

  return rows.map(mapCustomerRow);
}

export async function getCustomerDetail(
  db: SQLiteDatabase,
  customerId: string,
): Promise<CustomerDetail | null> {
  const customer = await db.getFirstAsync<CustomerRow>(
    `SELECT
       c.id,
       c.name,
       c.address,
       c.contact_number,
       c.email,
       c.active,
       COUNT(e.id) AS equipment_count
     FROM customers c
     LEFT JOIN customer_equipment e
       ON e.customer_id = c.id AND e.active = 1
     WHERE c.id = ?
     GROUP BY c.id`,
    customerId,
  );

  if (!customer) return null;

  const equipmentRows = await db.getAllAsync<EquipmentRow>(
    `SELECT
       id,
       customer_id,
       machine_type,
       model,
       serial_number,
       nickname_or_location,
       notes,
       active
     FROM customer_equipment
     WHERE customer_id = ?
     ORDER BY active DESC, machine_type COLLATE NOCASE ASC, created_at DESC`,
    customerId,
  );

  return {
    ...mapCustomerRow(customer),
    equipment: equipmentRows.map(mapEquipmentRow),
  };
}

export async function createCustomer(
  db: SQLiteDatabase,
  input: CreateCustomerInput,
): Promise<string> {
  const name = normalizeCustomerName(input.name);
  const address = input.address?.trim() ?? '';
  const contactNumber = input.contactNumber?.trim() ?? '';
  const email = input.email?.trim() ?? '';

  if (!name) throw new Error('Customer name is required.');
  assertOptionalEmail(email);

  const customerId = Crypto.randomUUID();
  const now = new Date().toISOString();
  let usedDuplicateNameOverride = false;

  await db.withExclusiveTransactionAsync(async (tx) => {
    const duplicate = await tx.getFirstAsync<{ id: string }>(
      `SELECT id FROM customers
       WHERE merged_into_customer_id IS NULL
         AND lower(trim(name)) = lower(trim(?))
       LIMIT 1`,
      name,
    );

    if (duplicate && !input.allowDuplicateName) {
      throw new DuplicateCustomerNameError(name);
    }
    usedDuplicateNameOverride = Boolean(duplicate && input.allowDuplicateName);

    await tx.runAsync(
      `INSERT INTO customers
        (id, name, address, contact_number, email, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      customerId,
      name,
      address,
      contactNumber,
      email,
      now,
      now,
    );

    await appendAuditEvent(tx, {
      eventType: usedDuplicateNameOverride
        ? 'customer.created_duplicate_name_override'
        : 'customer.created',
      entityType: 'customer',
      entityId: customerId,
      details: { name },
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });

  return customerId;
}

export async function createEquipment(
  db: SQLiteDatabase,
  input: CreateEquipmentInput,
): Promise<string> {
  const machineType = input.machineType.trim();
  if (!machineType) throw new Error('Machine or equipment type is required.');

  const equipmentId = Crypto.randomUUID();
  const now = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (tx) => {
    const customer = await tx.getFirstAsync<{ active: number }>(
      `SELECT active FROM customers
       WHERE id = ? AND merged_into_customer_id IS NULL`,
      input.customerId,
    );
    if (!customer) throw new Error('Customer was not found.');
    if (customer.active !== 1) throw new Error('Reactivate the customer before adding equipment.');

    await tx.runAsync(
      `INSERT INTO customer_equipment
        (id, customer_id, machine_type, model, serial_number,
         nickname_or_location, notes, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      equipmentId,
      input.customerId,
      machineType,
      input.model?.trim() ?? '',
      input.serialNumber?.trim() ?? '',
      input.nicknameOrLocation?.trim() ?? '',
      input.notes?.trim() ?? '',
      now,
      now,
    );

    await appendAuditEvent(tx, {
      eventType: 'equipment.created',
      entityType: 'customer_equipment',
      entityId: equipmentId,
      details: { customerId: input.customerId, serialNumber: input.serialNumber?.trim() ?? '' },
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });

  return equipmentId;
}

export async function setCustomerActive(
  db: SQLiteDatabase,
  customerId: string,
  active: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const result = await tx.runAsync(
      `UPDATE customers
       SET active = ?, updated_at = ?
       WHERE id = ? AND merged_into_customer_id IS NULL`,
      active ? 1 : 0,
      now,
      customerId,
    );
    if (result.changes !== 1) throw new Error('Customer was not found.');

    await appendAuditEvent(tx, {
      eventType: active ? 'customer.reactivated' : 'customer.deactivated',
      entityType: 'customer',
      entityId: customerId,
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });
}

export async function setEquipmentActive(
  db: SQLiteDatabase,
  equipmentId: string,
  active: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const result = await tx.runAsync(
      `UPDATE customer_equipment
       SET active = ?, updated_at = ?
       WHERE id = ?`,
      active ? 1 : 0,
      now,
      equipmentId,
    );
    if (result.changes !== 1) throw new Error('Equipment was not found.');

    await appendAuditEvent(tx, {
      eventType: active ? 'equipment.reactivated' : 'equipment.deactivated',
      entityType: 'customer_equipment',
      entityId: equipmentId,
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });
}

function mapCustomerRow(row: CustomerRow): CustomerSummary {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    contactNumber: row.contact_number,
    email: row.email,
    active: row.active === 1,
    equipmentCount: row.equipment_count,
  };
}

function mapEquipmentRow(row: EquipmentRow): CustomerEquipment {
  return {
    id: row.id,
    customerId: row.customer_id,
    machineType: row.machine_type,
    model: row.model,
    serialNumber: row.serial_number,
    nicknameOrLocation: row.nickname_or_location,
    notes: row.notes,
    active: row.active === 1,
  };
}
