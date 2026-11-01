import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { assertPositiveIntegerQuantity } from '@/domain/stock';
import { formatMachineLabel } from '@/features/service-reports/machine-label';
import { calculateServiceReportTotal } from '@/features/service-reports/service-report-total';

// Transaction-only helpers. Callers own the exclusive transaction and linked billing sync.
export async function insertCsrItemUsage(
  db: SQLiteDatabase,
  reportId: string,
  itemId: string,
  quantity: number,
  billable: boolean,
  overridePriceCentavos?: number,
  overrideReason?: string,
): Promise<string> {
  assertPositiveIntegerQuantity(quantity);
  const usageId = Crypto.randomUUID();
  const now = new Date().toISOString();

  const tx = db;
  const report = await tx.getFirstAsync<{ customer_id: string }>(
    "SELECT customer_id FROM service_reports WHERE id = ? AND document_state = 'draft'",
    reportId,
  );
  if (!report) throw new Error('Only a draft CSR can accept item usage.');
  const item = await tx.getFirstAsync<{
    name: string;
    active: number;
    base_selling_price_centavos: number;
    customer_price_centavos: number | null;
    current_stock: number;
  }>(
    `SELECT i.name, i.active, i.base_selling_price_centavos,
            p.selling_price_centavos AS customer_price_centavos,
            COALESCE((SELECT SUM(m.quantity_delta_integer) FROM inventory_movements m WHERE m.item_id = i.id), 0) AS current_stock
     FROM items i
     LEFT JOIN customer_item_prices p
       ON p.item_id = i.id AND p.customer_id = ? AND p.effective_to IS NULL
     WHERE i.id = ?`,
    report.customer_id,
    itemId,
  );
  if (!item || item.active !== 1) throw new Error('Select an active inventory item.');
  if (quantity > item.current_stock) {
    throw new Error(`Only ${item.current_stock} unit(s) are currently available.`);
  }
  const resolved = item.customer_price_centavos ?? item.base_selling_price_centavos;
  const price = overridePriceCentavos ?? resolved;
  assertNonNegativeMoney(price, 'Item price');
  const overridden = price !== resolved;
  const reason = overrideReason?.trim() || null;
  if (overridden && !reason) throw new Error('A reason is required when overriding the resolved item price.');
  const source = overridden ? 'override' : item.customer_price_centavos === null ? 'base' : 'customer';
  try {
    await tx.runAsync(
      `INSERT INTO service_report_item_usage
        (id, service_report_id, item_id, quantity_integer, billable,
         resolved_selling_price_centavos, price_source, override_reason, description_snapshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      usageId,
      reportId,
      itemId,
      quantity,
      billable ? 1 : 0,
      billable ? price : null,
      billable ? source : null,
      billable && overridden ? reason : null,
      item.name,
      now,
    );
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new Error('This item is already listed on the CSR.');
    throw error;
  }
  await recalculateServiceReportTotal(tx, reportId);
  await appendAuditEvent(tx, {
    eventType: 'csr.item_usage_added',
    entityType: 'service_report',
    entityId: reportId,
    details: { itemId, quantity, billable },
    createdAt: now,
  });
  await incrementDatabaseRevision(tx);
  return usageId;
}


export type MachineServiceInput = {
  equipmentId: string;
  serviceId: string;
  rateCentavos: number;
  note?: string;
};

/** Machine ids on a CSR; legacy rows without join entries fall back to the primary machine. */
export async function listReportMachineIds(db: SQLiteDatabase, reportId: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ equipment_id: string }>(
    'SELECT equipment_id FROM service_report_equipment WHERE service_report_id = ? ORDER BY position ASC',
    reportId,
  );
  if (rows.length > 0) return rows.map((row) => row.equipment_id);
  const primary = await db.getFirstAsync<{ equipment_id: string }>('SELECT equipment_id FROM service_reports WHERE id = ?', reportId);
  return primary ? [primary.equipment_id] : [];
}

/**
 * Prices one service on one machine of a draft CSR. Duplicates are allowed:
 * the same service can be added to a machine again at a different price.
 * Callers own the transaction and the linked billing sync.
 */
export async function insertMachineService(db: SQLiteDatabase, reportId: string, input: MachineServiceInput): Promise<string> {
  assertNonNegativeMoney(input.rateCentavos, 'Service price');
  const tx = db;
  const report = await tx.getFirstAsync<{ id: string }>(
    "SELECT id FROM service_reports WHERE id = ? AND document_state = 'draft'",
    reportId,
  );
  if (!report) throw new Error('Only a draft CSR can accept service charges.');
  if (!(await listReportMachineIds(tx, reportId)).includes(input.equipmentId)) {
    throw new Error('That machine is not listed on this CSR.');
  }
  const service = await tx.getFirstAsync<{ name: string; active: number; base_rate_centavos: number }>(
    'SELECT name, active, base_rate_centavos FROM services WHERE id = ?',
    input.serviceId,
  );
  if (!service || service.active !== 1) throw new Error('Select an active service.');
  const machine = await tx.getFirstAsync<{ machine_type: string; nickname_or_location: string; serial_number: string }>(
    'SELECT machine_type, nickname_or_location, serial_number FROM customer_equipment WHERE id = ?',
    input.equipmentId,
  );
  if (!machine) throw new Error('Machine was not found.');

  const id = Crypto.randomUUID();
  const now = new Date().toISOString();
  await tx.runAsync(
    `INSERT INTO service_report_machine_service
      (id, service_report_id, equipment_id, service_id, rate_centavos, rate_source,
       description_snapshot, machine_label, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    reportId,
    input.equipmentId,
    input.serviceId,
    input.rateCentavos,
    input.rateCentavos === service.base_rate_centavos ? 'catalog' : 'custom',
    service.name,
    formatMachineLabel({ machineType: machine.machine_type, nicknameOrLocation: machine.nickname_or_location, serialNumber: machine.serial_number }),
    input.note?.trim() || null,
    now,
  );
  await recalculateServiceReportTotal(tx, reportId);
  await appendAuditEvent(tx, {
    eventType: 'csr.machine_service_added',
    entityType: 'service_report',
    entityId: reportId,
    details: { serviceId: input.serviceId, equipmentId: input.equipmentId, rateCentavos: input.rateCentavos },
    createdAt: now,
  });
  await incrementDatabaseRevision(tx);
  return id;
}

/** Adds one service to every machine on the CSR at the same price. */
export async function insertServiceOnAllMachines(
  db: SQLiteDatabase,
  reportId: string,
  serviceId: string,
  rateCentavos: number | undefined,
  note?: string,
): Promise<string[]> {
  let rate = rateCentavos;
  if (rate === undefined) {
    const service = await db.getFirstAsync<{ base_rate_centavos: number }>('SELECT base_rate_centavos FROM services WHERE id = ?', serviceId);
    if (!service) throw new Error('Select an active service.');
    rate = service.base_rate_centavos;
  }
  const ids: string[] = [];
  for (const equipmentId of await listReportMachineIds(db, reportId)) {
    ids.push(await insertMachineService(db, reportId, { equipmentId, serviceId, rateCentavos: rate, note }));
  }
  return ids;
}

export async function recalculateServiceReportTotal(
  db: SQLiteDatabase,
  reportId: string,
): Promise<number> {
  const [items, services] = await Promise.all([
    db.getAllAsync<{
      quantity_integer: number;
      billable: number;
      resolved_selling_price_centavos: number | null;
    }>(
      `SELECT quantity_integer, billable, resolved_selling_price_centavos
       FROM service_report_item_usage WHERE service_report_id = ?`,
      reportId,
    ),
    db.getAllAsync<{ rate_centavos: number }>(
      'SELECT rate_centavos FROM service_report_machine_service WHERE service_report_id = ?',
      reportId,
    ),
  ]);
  const total = calculateServiceReportTotal(
    items.map((item) => ({
      quantity: item.quantity_integer,
      billable: item.billable === 1,
      resolvedSellingPriceCentavos: item.resolved_selling_price_centavos,
    })),
    services.map((service) => ({ resolvedRateCentavos: service.rate_centavos })),
  );
  await db.runAsync(
    "UPDATE service_reports SET total_bill_centavos = ? WHERE id = ? AND document_state = 'draft'",
    total,
    reportId,
  );
  return total;
}

function assertNonNegativeMoney(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(label + ' must be a non-negative amount.');
}
