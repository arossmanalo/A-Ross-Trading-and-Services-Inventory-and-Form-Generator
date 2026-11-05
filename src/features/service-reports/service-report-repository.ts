import { getBusinessLogo } from '@/features/settings/settings-repository';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { allocateDocumentNumber } from '@/db/sequences';
import { getLocalBusinessDate, validateBusinessDate } from '@/domain/business-date';
import { assertPositiveIntegerQuantity } from '@/domain/stock';
import { buildCsrHtml, CSR_TEMPLATE_VERSION, type CsrRenderSnapshot } from '@/features/service-reports/csr-template';
import { assertLinkedCsrChargesAreSourced, deleteLinkedBillingStatementDrafts, syncLinkedCsrDraftLines } from '@/features/billing-statements/billing-statement-repository';
import { getPreparerSignatureHtml } from '@/features/signatures/capture-repository';
import { calculateServiceReportTotal } from '@/features/service-reports/service-report-total';
import { insertCsrItemUsage, insertMachineService, insertServiceOnAllMachines, recalculateServiceReportTotal } from '@/features/service-reports/csr-charge-repository';
import type {
  CreateServiceReportDraftInput,
  DocumentState,
  ServiceOutcome,
  ServiceReportDetail,
  ServiceReportMachine,
  ServiceReportLinkedStatement,
  ServiceReportListItem,
  ServiceReportMachineService,
  ServiceReportSummary,
  ServiceReportUsage,
  UpdateServiceReportDraftInput,
} from '@/features/service-reports/service-report-types';

type SummaryRow = {
  id: string;
  csr_number: string | null;
  customer_name: string;
  equipment_name: string;
  document_state: DocumentState;
  service_outcome: ServiceOutcome;
  business_date: string;
  pdf_state: ServiceReportSummary['pdfState'];
  total_bill_centavos: number;
};

type DetailRow = SummaryRow & {
  customer_id: string;
  equipment_id: string;
  follows_csr_id: string | null;
  reported_problem_json: string;
  diagnosis_json: string;
  action_taken_json: string;
  recommendations_json: string;
  billing_json: string;
  customer_remarks_json: string;
  machine_status: string;
  warranty_text: string;
  serviced_by_snapshot: string;
  acknowledged_by_snapshot: string;
  total_bill_centavos: number;
  signature_status: string;
  has_signed_version?: number;
  share_state: 'not_shared' | 'shared';
  finalized_at: string | null;
  customer_type: 'individual' | 'company';
};

type UsageRow = {
  id: string;
  item_id: string;
  item_name: string;
  item_sku: string | null;
  unit_label: string;
  quantity_integer: number;
  current_stock: number;
  billable: number;
  resolved_selling_price_centavos: number | null;
  price_source: ServiceReportUsage['priceSource'];
  override_reason: string | null;
};

type FinalizationUsageRow = UsageRow & {
  base_selling_price_centavos: number;
  customer_price_centavos: number | null;
};

type MachineServiceRow = {
  id: string;
  equipment_id: string;
  service_id: string;
  description_snapshot: string;
  machine_label: string;
  rate_centavos: number;
  rate_source: 'catalog' | 'custom';
  note: string | null;
};

export class DraftPriceChangedError extends Error {
  constructor(readonly itemNames: string[]) {
    super(`Pricing changed for: ${itemNames.join(', ')}. Choose which prices to retain.`);
    this.name = 'DraftPriceChangedError';
  }
}

type MachineRow = {
  equipment_id: string;
  machine_type: string;
  model: string;
  serial_number: string;
  nickname_or_location: string;
};

/** Machines on a CSR in the order they were assigned; legacy rows fall back to the primary machine. */
export async function listReportMachines(db: SQLiteDatabase, reportId: string): Promise<ServiceReportMachine[]> {
  let rows = await db.getAllAsync<MachineRow>(
    `SELECT e.id AS equipment_id, e.machine_type, e.model, e.serial_number, e.nickname_or_location
     FROM service_report_equipment re
     JOIN customer_equipment e ON e.id = re.equipment_id
     WHERE re.service_report_id = ?
     ORDER BY re.position ASC`,
    reportId,
  );
  if (rows.length === 0) {
    rows = await db.getAllAsync<MachineRow>(
      `SELECT e.id AS equipment_id, e.machine_type, e.model, e.serial_number, e.nickname_or_location
       FROM service_reports r JOIN customer_equipment e ON e.id = r.equipment_id
       WHERE r.id = ?`,
      reportId,
    );
  }
  return rows.map((row) => ({
    equipmentId: row.equipment_id,
    machineType: row.machine_type,
    model: row.model,
    serialNumber: row.serial_number,
    nicknameOrLocation: row.nickname_or_location,
  }));
}

/** Billing Statements per CSR; pass a report id to load just that CSR's. */
async function loadLinkedStatements(db: SQLiteDatabase, reportId?: string): Promise<Map<string, ServiceReportLinkedStatement[]>> {
  const rows = await db.getAllAsync<{ id: string; service_report_id: string; bs_number: string | null; document_state: DocumentState; discounted_total_centavos: number }>(
    `SELECT id, service_report_id, bs_number, document_state, discounted_total_centavos
     FROM billing_statements
     WHERE service_report_id IS NOT NULL AND (? IS NULL OR service_report_id = ?)
     ORDER BY created_at ASC, rowid ASC`,
    reportId ?? null,
    reportId ?? null,
  );
  const grouped = new Map<string, ServiceReportLinkedStatement[]>();
  for (const row of rows) {
    const list = grouped.get(row.service_report_id) ?? [];
    list.push({ id: row.id, bsNumber: row.bs_number, documentState: row.document_state, totalCentavos: row.discounted_total_centavos });
    grouped.set(row.service_report_id, list);
  }
  return grouped;
}

const OUTCOME_WORDS: Record<ServiceOutcome, string> = {
  completed: 'completed',
  incomplete: 'incomplete',
  waiting_for_parts: 'waiting for parts',
  under_observation: 'under observation',
};

export async function listServiceReports(db: SQLiteDatabase): Promise<ServiceReportListItem[]> {
  const rows = await db.getAllAsync<SummaryRow & {
    customer_address: string;
    primary_model: string;
    primary_serial: string;
    primary_nickname: string;
    reported_problem_json: string;
    serviced_by_snapshot: string;
    acknowledged_by_snapshot: string;
  }>(
    `SELECT r.id, r.csr_number, c.name AS customer_name, c.address AS customer_address,
            e.machine_type || CASE
              WHEN (SELECT COUNT(*) FROM service_report_equipment x WHERE x.service_report_id = r.id) > 1
              THEN ' +' || ((SELECT COUNT(*) FROM service_report_equipment x WHERE x.service_report_id = r.id) - 1) || ' more'
              ELSE '' END AS equipment_name,
            e.model AS primary_model, e.serial_number AS primary_serial, e.nickname_or_location AS primary_nickname,
            r.document_state, r.service_outcome, r.business_date, r.pdf_state, r.total_bill_centavos,
            r.reported_problem_json, r.serviced_by_snapshot, r.acknowledged_by_snapshot
     FROM service_reports r
     JOIN customers c ON c.id = r.customer_id
     JOIN customer_equipment e ON e.id = r.equipment_id
     ORDER BY r.created_at DESC`,
  );
  const machineRows = await db.getAllAsync<{ service_report_id: string; machine_type: string; model: string; serial_number: string; nickname_or_location: string }>(
    `SELECT re.service_report_id, q.machine_type, q.model, q.serial_number, q.nickname_or_location
     FROM service_report_equipment re JOIN customer_equipment q ON q.id = re.equipment_id`,
  );
  const machineText = new Map<string, string[]>();
  for (const machine of machineRows) {
    machineText.set(machine.service_report_id, [...(machineText.get(machine.service_report_id) ?? []), machine.machine_type, machine.model, machine.serial_number, machine.nickname_or_location]);
  }
  const linked = await loadLinkedStatements(db);
  return rows.map((row) => {
    const summary = mapSummaryRow(row);
    const linkedStatements = linked.get(row.id) ?? [];
    const searchText = [
      row.csr_number ?? 'draft',
      row.customer_name,
      row.customer_address,
      row.business_date,
      row.document_state,
      row.service_outcome,
      OUTCOME_WORDS[row.service_outcome],
      row.equipment_name,
      row.primary_model,
      row.primary_serial,
      row.primary_nickname,
      ...(machineText.get(row.id) ?? []),
      ...linkedStatements.map((statement) => statement.bsNumber ?? 'draft statement'),
      ...parseEntries(row.reported_problem_json),
      row.serviced_by_snapshot,
      row.acknowledged_by_snapshot,
    ].join(' ').toLowerCase();
    return { ...summary, linkedStatements, searchText };
  });
}

export async function getServiceReport(
  db: SQLiteDatabase,
  reportId: string,
): Promise<ServiceReportDetail | null> {
  const row = await db.getFirstAsync<DetailRow>(
    `SELECT r.*, c.name AS customer_name, c.customer_type, e.machine_type AS equipment_name,
            CASE WHEN EXISTS (
              SELECT 1 FROM signature_captures sc
              WHERE sc.owner_type='service_report' AND sc.owner_id=r.id
            ) OR EXISTS (
              SELECT 1 FROM document_attachments da
              WHERE da.owner_type='service_report' AND da.owner_id=r.id
                AND da.attachment_type='external_signed_pdf'
            ) THEN 1 ELSE 0 END AS has_signed_version
     FROM service_reports r
     JOIN customers c ON c.id = r.customer_id
     JOIN customer_equipment e ON e.id = r.equipment_id
     WHERE r.id = ?`,
    reportId,
  );
  if (!row) return null;
  const usages = await listReportUsages(db, reportId);
  const machineServices = await listReportMachineServices(db, reportId);
  const machines = await listReportMachines(db, reportId);
  const machineCount = Math.max(1, machines.length);
  const detail = { ...mapDetailRow(row), linkedStatements: (await loadLinkedStatements(db, reportId)).get(reportId) ?? [] };
  const memberRows = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM customer_members WHERE customer_id = ? AND active = 1 ORDER BY name COLLATE NOCASE ASC`,
    row.customer_id,
  );
  return {
    ...detail,
    totalBillCentavos: row.document_state === 'draft'
      ? calculateServiceReportTotal(usages, machineServices.map((service) => ({ resolvedRateCentavos: service.rateCentavos })))
      : detail.totalBillCentavos,
    machines,
    machineCount,
    usages,
    machineServices,
    acknowledgmentOptions: row.customer_type === 'individual' ? [row.customer_name] : memberRows.map((member) => member.name),
  };
}

export async function createServiceReportDraft(
  db: SQLiteDatabase,
  input: CreateServiceReportDraftInput,
): Promise<string> {
  let reportId = '';
  await db.withExclusiveTransactionAsync(async (tx) => {
    reportId = await createServiceReportDraftInTx(tx, input);
  });
  return reportId;
}

/** Transaction-only form of createServiceReportDraft, for callers that already hold the transaction. */
export async function createServiceReportDraftInTx(
  tx: SQLiteDatabase,
  input: CreateServiceReportDraftInput,
): Promise<string> {
  validateBusinessDate(input.businessDate);
  const equipmentIds = [input.equipmentId, ...(input.additionalEquipmentIds ?? [])];
  if (new Set(equipmentIds).size !== equipmentIds.length) throw new Error('Each machine can be listed only once on a CSR.');
  const reportId = Crypto.randomUUID();
  const now = new Date().toISOString();

  for (const additionalId of equipmentIds.slice(1)) {
    await assertMachineAvailable(tx, input.customerId, additionalId);
  }
  const equipment = await tx.getFirstAsync<{
    customer_id: string;
    customer_active: number;
    equipment_active: number;
    customer_name: string;
    customer_type: 'individual' | 'company';
  }>(
    `SELECT e.customer_id, c.name AS customer_name, c.customer_type, c.active AS customer_active, e.active AS equipment_active
     FROM customer_equipment e
     JOIN customers c ON c.id = e.customer_id
     WHERE e.id = ? AND c.merged_into_customer_id IS NULL`,
    input.equipmentId,
  );
  if (!equipment || equipment.customer_id !== input.customerId) {
    throw new Error('Selected equipment does not belong to this customer.');
  }
  if (equipment.customer_active !== 1 || equipment.equipment_active !== 1) {
    throw new Error('Customer and equipment must be active for new service work.');
  }

  const settings = await tx.getFirstAsync<{ owner_name: string }>("SELECT owner_name FROM settings WHERE id = 'business'");
  const memberRows = equipment.customer_type === 'company'
    ? await tx.getAllAsync<{ name: string }>('SELECT name FROM customer_members WHERE customer_id = ? AND active = 1 ORDER BY name COLLATE NOCASE ASC', input.customerId)
    : [];
  const acknowledgedBy = equipment.customer_type === 'individual'
    ? equipment.customer_name
    : memberRows.length === 1 ? memberRows[0].name : '';

  if (input.followsCsrId) {
    const previous = await tx.getFirstAsync<{ customer_id: string; equipment_id: string; document_state: string }>(
      'SELECT customer_id, equipment_id, document_state FROM service_reports WHERE id = ?',
      input.followsCsrId,
    );
    if (!previous || previous.document_state !== 'finalized') {
      throw new Error('A follow-up must reference a finalized CSR.');
    }
    const previousMachineIds = new Set((await listReportMachines(tx, input.followsCsrId)).map((machine) => machine.equipmentId));
    previousMachineIds.add(previous.equipment_id);
    if (previous.customer_id !== input.customerId || equipmentIds.some((id) => !previousMachineIds.has(id))) {
      throw new Error('A follow-up must use the same customer and machines from the original CSR.');
    }
  }

  await tx.runAsync(
    `INSERT INTO service_reports
      (id, customer_id, equipment_id, follows_csr_id, business_date,
       serviced_by_snapshot, acknowledged_by_snapshot,
       document_state, service_outcome, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 'incomplete', ?)`,
    reportId,
    input.customerId,
    input.equipmentId,
    input.followsCsrId ?? null,
    input.businessDate,
    settings?.owner_name?.trim() ?? '',
    acknowledgedBy,
    now,
  );
  for (const [index, equipmentId] of equipmentIds.entries()) {
    await tx.runAsync(
      'INSERT INTO service_report_equipment (service_report_id, equipment_id, position, created_at) VALUES (?, ?, ?, ?)',
      reportId, equipmentId, index + 1, now,
    );
  }
  await appendAuditEvent(tx, {
    eventType: input.followsCsrId ? 'csr.follow_up_draft_created' : 'csr.draft_created',
    entityType: 'service_report',
    entityId: reportId,
    details: { followsCsrId: input.followsCsrId ?? null, machineCount: equipmentIds.length },
    createdAt: now,
  });
  await incrementDatabaseRevision(tx);
  return reportId;
}

export async function updateServiceReportDraft(
  db: SQLiteDatabase,
  reportId: string,
  input: UpdateServiceReportDraftInput,
): Promise<void> {
  validateBusinessDate(input.businessDate);
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const update = await tx.runAsync(
      `UPDATE service_reports
       SET service_outcome = ?, business_date = ?,
           reported_problem_json = ?, diagnosis_json = ?, action_taken_json = ?,
           recommendations_json = ?, billing_json = ?, customer_remarks_json = ?,
           machine_status = ?, warranty_text = ?, serviced_by_snapshot = ?,
           acknowledged_by_snapshot = ?
       WHERE id = ? AND document_state = 'draft'`,
      input.serviceOutcome,
      input.businessDate,
      JSON.stringify(cleanEntries(input.reportedProblem)),
      JSON.stringify(cleanEntries(input.diagnosis)),
      JSON.stringify(cleanEntries(input.actionTaken)),
      JSON.stringify(cleanEntries(input.recommendations)),
      JSON.stringify(cleanEntries(input.billing)),
      JSON.stringify(cleanEntries(input.customerRemarks)),
      input.machineStatus.trim(),
      input.warrantyText.trim(),
      input.servicedBy.trim(),
      input.acknowledgedBy.trim(),
      reportId,
    );
    if (update.changes !== 1) throw new Error('Only a draft CSR can be edited.');
    await recalculateServiceReportTotal(tx, reportId);
    await appendAuditEvent(tx, {
      eventType: 'csr.draft_saved',
      entityType: 'service_report',
      entityId: reportId,
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });
}

export async function addReportItemUsage(db: SQLiteDatabase, reportId: string, itemId: string, quantity: number, billable: boolean): Promise<string> {
  let usageId = '';
  await db.withExclusiveTransactionAsync(async (tx) => {
    usageId = await insertCsrItemUsage(tx, reportId, itemId, quantity, billable);
    await syncLinkedCsrDraftLines(tx, reportId);
  });
  return usageId;
}

export async function removeReportItemUsage(
  db: SQLiteDatabase,
  reportId: string,
  usageId: string,
): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      `DELETE FROM billing_statement_lines
       WHERE source_csr_usage_id=?
         AND billing_statement_id IN (
           SELECT id FROM billing_statements WHERE service_report_id=? AND document_state='draft'
         )`,
      usageId,
      reportId,
    );
    const result = await tx.runAsync(
      `DELETE FROM service_report_item_usage
       WHERE id = ? AND service_report_id = ?
         AND EXISTS (SELECT 1 FROM service_reports WHERE id = ? AND document_state = 'draft')`,
      usageId,
      reportId,
      reportId,
    );
    if (result.changes !== 1) throw new Error('Only draft item usage can be removed.');
    await syncLinkedCsrDraftLines(tx, reportId);
    await recalculateServiceReportTotal(tx, reportId);
    await appendAuditEvent(tx, {
      eventType: 'csr.item_usage_removed',
      entityType: 'service_report',
      entityId: reportId,
      createdAt: new Date().toISOString(),
    });
    await incrementDatabaseRevision(tx);
  });
}

/**
 * Compatibility helper: adds one service to every machine on the CSR at one
 * price. The per-machine API below is the normal way to price a service.
 */
export async function addReportServiceUsage(db: SQLiteDatabase, reportId: string, serviceId: string, rateCentavos?: number, note?: string): Promise<string> {
  let firstId = '';
  await db.withExclusiveTransactionAsync(async (tx) => {
    [firstId] = await insertServiceOnAllMachines(tx, reportId, serviceId, rateCentavos, note);
    await syncLinkedCsrDraftLines(tx, reportId);
  });
  return firstId;
}

/**
 * Prices a service on a machine of a draft CSR. `alsoEquipmentIds` repeats it at
 * the same price on other machines. The same service may be added again to a
 * machine at another price.
 */
export async function addMachineService(
  db: SQLiteDatabase,
  reportId: string,
  input: { equipmentId: string; serviceId: string; rateCentavos: number; note?: string; alsoEquipmentIds?: string[] },
): Promise<string> {
  const machineIds = [input.equipmentId, ...(input.alsoEquipmentIds ?? [])];
  if (new Set(machineIds).size !== machineIds.length) throw new Error('Each machine can be selected only once.');
  let firstId = '';
  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const [index, equipmentId] of machineIds.entries()) {
      const id = await insertMachineService(tx, reportId, { equipmentId, serviceId: input.serviceId, rateCentavos: input.rateCentavos, note: input.note });
      if (index === 0) firstId = id;
    }
    await syncLinkedCsrDraftLines(tx, reportId);
  });
  return firstId;
}

export async function updateMachineService(
  db: SQLiteDatabase,
  reportId: string,
  rowId: string,
  input: { rateCentavos: number; note?: string },
): Promise<void> {
  if (!Number.isSafeInteger(input.rateCentavos) || input.rateCentavos < 0) throw new Error('Service price must be a non-negative amount.');
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ base_rate_centavos: number }>(
      `SELECT s.base_rate_centavos
       FROM service_report_machine_service m
       JOIN services s ON s.id = m.service_id
       JOIN service_reports r ON r.id = m.service_report_id
       WHERE m.id = ? AND m.service_report_id = ? AND r.document_state = 'draft'`,
      rowId,
      reportId,
    );
    if (!row) throw new Error('Only a draft CSR service price can be changed.');
    await tx.runAsync(
      'UPDATE service_report_machine_service SET rate_centavos = ?, rate_source = ?, note = ? WHERE id = ?',
      input.rateCentavos,
      input.rateCentavos === row.base_rate_centavos ? 'catalog' : 'custom',
      input.note?.trim() || null,
      rowId,
    );
    await recalculateServiceReportTotal(tx, reportId);
    await syncLinkedCsrDraftLines(tx, reportId);
    await appendAuditEvent(tx, {
      eventType: 'csr.machine_service_updated',
      entityType: 'service_report',
      entityId: reportId,
      details: { rowId, rateCentavos: input.rateCentavos },
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });
}

export async function removeMachineService(db: SQLiteDatabase, reportId: string, rowId: string): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    // Lines first: they reference the row, and foreign keys are enforced.
    await tx.runAsync(
      `DELETE FROM billing_statement_lines
       WHERE source_csr_machine_service_id = ?
         AND billing_statement_id IN (
           SELECT id FROM billing_statements WHERE service_report_id = ? AND document_state = 'draft'
         )`,
      rowId,
      reportId,
    );
    const result = await tx.runAsync(
      `DELETE FROM service_report_machine_service
       WHERE id = ? AND service_report_id = ?
         AND EXISTS (SELECT 1 FROM service_reports WHERE id = ? AND document_state = 'draft')`,
      rowId,
      reportId,
      reportId,
    );
    if (result.changes !== 1) throw new Error('Only draft service charges can be removed.');
    await syncLinkedCsrDraftLines(tx, reportId);
    await recalculateServiceReportTotal(tx, reportId);
    await appendAuditEvent(tx, {
      eventType: 'csr.machine_service_removed',
      entityType: 'service_report',
      entityId: reportId,
      details: { rowId },
      createdAt: new Date().toISOString(),
    });
    await incrementDatabaseRevision(tx);
  });
}

async function assertMachineAvailable(db: SQLiteDatabase, customerId: string, equipmentId: string): Promise<void> {
  const machine = await db.getFirstAsync<{ customer_id: string; customer_active: number; equipment_active: number }>(
    `SELECT e.customer_id, c.active AS customer_active, e.active AS equipment_active
     FROM customer_equipment e JOIN customers c ON c.id = e.customer_id
     WHERE e.id = ? AND c.merged_into_customer_id IS NULL`,
    equipmentId,
  );
  if (!machine || machine.customer_id !== customerId) throw new Error('Selected equipment does not belong to this customer.');
  if (machine.customer_active !== 1 || machine.equipment_active !== 1) {
    throw new Error('Customer and equipment must be active for new service work.');
  }
}

/** Adds a machine to a draft CSR. Service charges are re-multiplied and linked statement drafts re-synchronized. */
export async function addReportEquipment(db: SQLiteDatabase, reportId: string, equipmentId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const report = await tx.getFirstAsync<{ customer_id: string }>(
      "SELECT customer_id FROM service_reports WHERE id = ? AND document_state = 'draft'",
      reportId,
    );
    if (!report) throw new Error('Machines can only be changed on a draft CSR.');
    await assertMachineAvailable(tx, report.customer_id, equipmentId);
    const machines = await listReportMachines(tx, reportId);
    if (machines.some((machine) => machine.equipmentId === equipmentId)) throw new Error('This machine is already listed on the CSR.');
    // Legacy drafts may have no join rows; materialize the primary machine first.
    await tx.runAsync(
      `INSERT OR IGNORE INTO service_report_equipment (service_report_id, equipment_id, position, created_at)
       SELECT id, equipment_id, 1, created_at FROM service_reports WHERE id = ?`,
      reportId,
    );
    await tx.runAsync(
      'INSERT INTO service_report_equipment (service_report_id, equipment_id, position, created_at) VALUES (?, ?, ?, ?)',
      reportId, equipmentId, machines.length + 1, now,
    );
    await recalculateServiceReportTotal(tx, reportId);
    await syncLinkedCsrDraftLines(tx, reportId);
    await appendAuditEvent(tx, {
      eventType: 'csr.machine_added',
      entityType: 'service_report',
      entityId: reportId,
      details: { equipmentId, machineCount: machines.length + 1 },
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });
}

/** Removes a machine from a draft CSR. At least one machine must remain; the first remaining machine becomes primary. */
export async function removeReportEquipment(db: SQLiteDatabase, reportId: string, equipmentId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const report = await tx.getFirstAsync<{ id: string }>(
      "SELECT id FROM service_reports WHERE id = ? AND document_state = 'draft'",
      reportId,
    );
    if (!report) throw new Error('Machines can only be changed on a draft CSR.');
    const machines = await listReportMachines(tx, reportId);
    if (!machines.some((machine) => machine.equipmentId === equipmentId)) throw new Error('This machine is not listed on the CSR.');
    if (machines.length <= 1) throw new Error('A CSR needs at least one machine.');
    const remaining = machines.filter((machine) => machine.equipmentId !== equipmentId);
    await tx.runAsync(
      `DELETE FROM billing_statement_lines
       WHERE billing_statement_id IN (SELECT id FROM billing_statements WHERE service_report_id = ? AND document_state = 'draft')
         AND source_csr_machine_service_id IN (
           SELECT id FROM service_report_machine_service WHERE service_report_id = ? AND equipment_id = ?)`,
      reportId, reportId, equipmentId,
    );
    await tx.runAsync('DELETE FROM service_report_machine_service WHERE service_report_id = ? AND equipment_id = ?', reportId, equipmentId);
    await tx.runAsync('DELETE FROM service_report_equipment WHERE service_report_id = ?', reportId);
    for (const [index, machine] of remaining.entries()) {
      await tx.runAsync(
        'INSERT INTO service_report_equipment (service_report_id, equipment_id, position, created_at) VALUES (?, ?, ?, ?)',
        reportId, machine.equipmentId, index + 1, now,
      );
    }
    await tx.runAsync('UPDATE service_reports SET equipment_id = ? WHERE id = ?', remaining[0].equipmentId, reportId);
    await recalculateServiceReportTotal(tx, reportId);
    await syncLinkedCsrDraftLines(tx, reportId);
    await appendAuditEvent(tx, {
      eventType: 'csr.machine_removed',
      entityType: 'service_report',
      entityId: reportId,
      details: { equipmentId, machineCount: remaining.length },
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });
}

export async function deleteServiceReportDraft(
  db: SQLiteDatabase,
  reportId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const draft = await tx.getFirstAsync<{ id: string }>(
      "SELECT id FROM service_reports WHERE id = ? AND document_state = 'draft'",
      reportId,
    );
    if (!draft) throw new Error('Only an unnumbered draft can be deleted.');
    await deleteLinkedBillingStatementDrafts(tx, reportId, now);
    await tx.runAsync('DELETE FROM service_report_item_usage WHERE service_report_id = ?', reportId);
    await tx.runAsync('DELETE FROM service_report_service_usage WHERE service_report_id = ?', reportId);
    await tx.runAsync('DELETE FROM service_report_machine_service WHERE service_report_id = ?', reportId);
    await tx.runAsync('DELETE FROM service_report_equipment WHERE service_report_id = ?', reportId);
    await tx.runAsync("DELETE FROM service_reports WHERE id = ? AND document_state = 'draft'", reportId);
    await appendAuditEvent(tx, {
      eventType: 'csr.draft_deleted',
      entityType: 'service_report',
      entityId: reportId,
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });
}

export async function finalizeServiceReport(
  db: SQLiteDatabase,
  reportId: string,
  pricePolicy: 'keep-draft' | 'reject' | 'use-current' = 'reject',
): Promise<{ csrNumber: string; html: string; snapshot: CsrRenderSnapshot }> {
  let finalResult: { csrNumber: string; html: string; snapshot: CsrRenderSnapshot } | null = null;

  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<DetailRow & {
      customer_address: string;
      business_name: string;
      business_address: string;
      contact_details: string;
      equipment_model: string;
      serial_number: string;
      nickname_or_location: string;
      content_snapshot_json: string | null;
      render_template_snapshot: string | null;
    }>(
      `SELECT r.*, c.name AS customer_name, c.address AS customer_address,
              e.machine_type AS equipment_name, e.model AS equipment_model,
              e.serial_number, e.nickname_or_location,
              s.business_name, s.business_address, s.contact_details
       FROM service_reports r
       JOIN customers c ON c.id = r.customer_id
       JOIN customer_equipment e ON e.id = r.equipment_id
       JOIN settings s ON s.id = 'business'
       WHERE r.id = ?`,
      reportId,
    );
    if (!row) throw new Error('CSR was not found.');
    if (row.document_state === 'finalized') {
      if (!row.csr_number || !row.content_snapshot_json || !row.render_template_snapshot) {
        throw new Error('Finalized CSR snapshot is incomplete.');
      }
      finalResult = {
        csrNumber: row.csr_number,
        html: row.render_template_snapshot,
        snapshot: JSON.parse(row.content_snapshot_json) as CsrRenderSnapshot,
      };
      return;
    }
    if (row.document_state !== 'draft') throw new Error('Only a draft CSR can be finalized.');
    validateBusinessDate(row.business_date);

    await assertLinkedCsrChargesAreSourced(tx, reportId);
    let usages = await listFinalizationUsages(tx, reportId, row.customer_id);
    const machines = await listReportMachines(tx, reportId);
    const machineCount = Math.max(1, machines.length);
    const machineServices = await listReportMachineServices(tx, reportId);
    const machineNumberById = new Map(machines.map((machine, index) => [machine.equipmentId, index + 1]));
    const priceChanges: string[] = [];
    for (const usage of usages) {
      if (usage.quantity_integer > usage.current_stock) {
        throw new Error(`${usage.item_name}: only ${usage.current_stock} available, ${usage.quantity_integer} required.`);
      }
      if (usage.billable === 1 && usage.price_source !== 'override') {
        const currentPrice = usage.customer_price_centavos ?? usage.base_selling_price_centavos;
        if (usage.resolved_selling_price_centavos !== currentPrice) priceChanges.push(usage.item_name);
      }
    }
    if (priceChanges.length && pricePolicy === 'reject') throw new DraftPriceChangedError(priceChanges);

    for (const usage of usages) {
      if (usage.billable !== 1 || usage.price_source === 'override') continue;
      const currentPrice = usage.customer_price_centavos ?? usage.base_selling_price_centavos;
      const currentSource = usage.customer_price_centavos === null ? 'base' : 'customer';
      if (pricePolicy === 'use-current') {
        await tx.runAsync(
          `UPDATE service_report_item_usage
           SET resolved_selling_price_centavos = ?, price_source = ?, override_reason = NULL
           WHERE id = ?`,
          currentPrice,
          currentSource,
          usage.id,
        );
      } else if (pricePolicy === 'keep-draft' && usage.resolved_selling_price_centavos !== currentPrice) {
        await tx.runAsync(
          `UPDATE service_report_item_usage
           SET price_source = 'override', override_reason = 'Draft price retained after price change'
           WHERE id = ?`,
          usage.id,
        );
      }
    }
    usages = await listFinalizationUsages(tx, reportId, row.customer_id);
    const totalBillCentavos = calculateServiceReportTotal(usages.map((usage) => ({
      quantity: usage.quantity_integer,
      billable: usage.billable === 1,
      resolvedSellingPriceCentavos: usage.resolved_selling_price_centavos,
    })), machineServices.map((service) => ({ resolvedRateCentavos: service.rateCentavos })));
    await tx.runAsync('UPDATE service_reports SET total_bill_centavos = ? WHERE id = ?', totalBillCentavos, reportId);

    const csrNumber = await allocateDocumentNumber(tx, 'CSR');
    const snapshot: CsrRenderSnapshot = {
      preparerSignatureHtml: await getPreparerSignatureHtml(tx),
      csrNumber,
      businessDate: row.business_date,
      fingerprint: '',
      business: { name: row.business_name, address: row.business_address, contactDetails: row.contact_details },
      customer: { name: row.customer_name, address: row.customer_address },
      equipment: {
        machineType: row.equipment_name,
        model: row.equipment_model,
        serialNumber: row.serial_number,
        nicknameOrLocation: row.nickname_or_location,
      },
      machines: machines.map(({ machineType, model, serialNumber, nicknameOrLocation }) => ({ machineType, model, serialNumber, nicknameOrLocation })),
      machineCount,
      serviceOutcome: row.service_outcome,
      reportedProblem: parseEntries(row.reported_problem_json),
      diagnosis: parseEntries(row.diagnosis_json),
      actionTaken: parseEntries(row.action_taken_json),
      recommendations: parseEntries(row.recommendations_json),
      billing: parseEntries(row.billing_json),
      customerRemarks: parseEntries(row.customer_remarks_json),
      machineStatus: row.machine_status,
      warrantyText: row.warranty_text,
      servicedBy: row.serviced_by_snapshot,
      acknowledgedBy: row.acknowledged_by_snapshot,
      totalBillCentavos,
      usages: usages.map((usage) => ({
        description: usage.item_name,
        quantity: usage.quantity_integer,
        unitLabel: usage.unit_label,
        billable: usage.billable === 1,
      })),
      services: machineServices.map((service) => ({
        description: service.serviceName,
        rateCentavos: service.rateCentavos,
        machineLabel: service.machineLabel,
        machineNumber: machineNumberById.get(service.equipmentId) ?? 1,
        ...(service.note ? { note: service.note } : {}),
      })),
    };
    snapshot.business.logoDataUrl = await getBusinessLogo(tx);
    snapshot.fingerprint = (await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      JSON.stringify(snapshot),
    )).slice(0, 12).toUpperCase();
    const html = buildCsrHtml(snapshot);
    const transactionId = Crypto.randomUUID();
    const now = new Date().toISOString();
    await tx.runAsync(
      `INSERT INTO stock_transactions
        (id, customer_id, service_report_id, transaction_type, state, note, created_at)
       VALUES (?, ?, ?, 'usage', 'active', ?, ?)`,
      transactionId,
      row.customer_id,
      reportId,
      `Finalized ${csrNumber}`,
      now,
    );

    for (const usage of usages) {
      await tx.runAsync(
        `INSERT INTO inventory_movements
          (id, item_id, stock_transaction_id, movement_type, quantity_delta_integer,
           service_report_id, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        Crypto.randomUUID(),
        usage.item_id,
        transactionId,
        usage.billable === 1 ? 'sale' : 'nonbillable_usage',
        -usage.quantity_integer,
        reportId,
        `${csrNumber}: ${usage.item_name}`,
        now,
      );
    }

    await tx.runAsync(
      `UPDATE service_reports
       SET csr_number = ?, document_state = 'finalized', content_snapshot_json = ?,
           render_template_snapshot = ?, template_version = ?, pdf_state = 'pending', finalized_at = ?
       WHERE id = ? AND document_state = 'draft'`,
      csrNumber,
      JSON.stringify(snapshot),
      html,
      CSR_TEMPLATE_VERSION,
      now,
      reportId,
    );
    await syncLinkedCsrDraftLines(tx, reportId);
    await appendAuditEvent(tx, {
      eventType: 'csr.finalized',
      entityType: 'service_report',
      entityId: reportId,
      details: { csrNumber, itemCount: usages.length, pricePolicy },
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
    finalResult = { csrNumber, html, snapshot };
  });

  if (!finalResult) throw new Error('CSR finalization did not produce a result.');
  return finalResult;
}

export async function voidServiceReport(
  db: SQLiteDatabase,
  reportId: string,
  reason: string,
  dispositions: Array<{ itemId: string; returnedToStock: boolean }>,
  createReissue: boolean,
): Promise<string | null> {
  const voidReason = reason.trim();
  if (!voidReason) throw new Error('Void reason is required.');
  let reissueId: string | null = null;

  await db.withExclusiveTransactionAsync(async (tx) => {
    const report = await tx.getFirstAsync<{
      customer_id: string;
      equipment_id: string;
      csr_number: string;
      document_state: string;
    }>(
      'SELECT customer_id, equipment_id, csr_number, document_state FROM service_reports WHERE id = ?',
      reportId,
    );
    if (!report || report.document_state !== 'finalized') throw new Error('Only a finalized CSR can be voided.');

    const activeBilling = await tx.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM billing_statement_lines l
       JOIN billing_statements b ON b.id = l.billing_statement_id
       WHERE b.document_state <> 'voided'
         AND (l.source_csr_usage_id IN (SELECT id FROM service_report_item_usage WHERE service_report_id = ?)
           OR l.source_csr_service_usage_id IN (SELECT id FROM service_report_service_usage WHERE service_report_id = ?)
           OR l.source_csr_machine_service_id IN (SELECT id FROM service_report_machine_service WHERE service_report_id = ?))`,
      reportId,
      reportId,
      reportId,
    );
    if ((activeBilling?.count ?? 0) > 0) throw new Error('Void related Billing Statements before voiding this CSR.');

    const movements = await tx.getAllAsync<{
      id: string;
      item_id: string;
      quantity_delta_integer: number;
      stock_transaction_id: string;
    }>(
      `SELECT id, item_id, quantity_delta_integer, stock_transaction_id
       FROM inventory_movements
       WHERE service_report_id = ? AND movement_type IN ('sale', 'nonbillable_usage')`,
      reportId,
    );
    const choices = new Map(dispositions.map((entry) => [entry.itemId, entry.returnedToStock]));
    if (movements.some((movement) => !choices.has(movement.item_id))) {
      throw new Error('Choose a physical disposition for every item used.');
    }

    const now = new Date().toISOString();
    const correctionTransactionId = Crypto.randomUUID();
    await tx.runAsync(
      `INSERT INTO stock_transactions
        (id, customer_id, service_report_id, transaction_type, state, note, created_at)
       VALUES (?, ?, ?, 'reversal', 'active', ?, ?)`,
      correctionTransactionId,
      report.customer_id,
      reportId,
      `Void ${report.csr_number}: ${voidReason}`,
      now,
    );
    const originalTransactionIds = new Set<string>();
    for (const movement of movements) {
      originalTransactionIds.add(movement.stock_transaction_id);
      const quantity = Math.abs(movement.quantity_delta_integer);
      await tx.runAsync(
        `INSERT INTO inventory_movements
          (id, item_id, stock_transaction_id, movement_type, quantity_delta_integer,
           service_report_id, source_movement_id, description, created_at)
         VALUES (?, ?, ?, 'reversal', ?, ?, ?, ?, ?)`,
        Crypto.randomUUID(), movement.item_id, correctionTransactionId, quantity,
        reportId, movement.id, `${report.csr_number} void reversal`, now,
      );
      if (!choices.get(movement.item_id)) {
        await tx.runAsync(
          `INSERT INTO inventory_movements
            (id, item_id, stock_transaction_id, movement_type, quantity_delta_integer,
             service_report_id, source_movement_id, description, created_at)
           VALUES (?, ?, ?, 'consumption', ?, ?, ?, ?, ?)`,
          Crypto.randomUUID(), movement.item_id, correctionTransactionId, -quantity,
          reportId, movement.id, `${report.csr_number} retained as installed/consumed`, now,
        );
      }
    }
    for (const transactionId of originalTransactionIds) {
      await tx.runAsync("UPDATE stock_transactions SET state = 'voided', voided_at = ? WHERE id = ?", now, transactionId);
    }
    await tx.runAsync(
      `UPDATE service_reports
       SET document_state = 'voided', void_reason = ?, voided_at = ?
       WHERE id = ? AND document_state = 'finalized'`,
      voidReason, now, reportId,
    );

    if (createReissue) {
      reissueId = Crypto.randomUUID();
      await tx.runAsync(
        `INSERT INTO service_reports
          (id, customer_id, equipment_id, follows_csr_id, business_date,
           document_state, service_outcome, created_at)
         VALUES (?, ?, ?, ?, ?, 'draft', 'incomplete', ?)`,
        reissueId, report.customer_id, report.equipment_id, reportId, getLocalBusinessDate(), now,
      );
      for (const [index, machine] of (await listReportMachines(tx, reportId)).entries()) {
        await tx.runAsync(
          'INSERT INTO service_report_equipment (service_report_id, equipment_id, position, created_at) VALUES (?, ?, ?, ?)',
          reissueId, machine.equipmentId, index + 1, now,
        );
      }
    }

    await appendAuditEvent(tx, {
      eventType: createReissue ? 'csr.voided_and_reissued' : 'csr.voided',
      entityType: 'service_report',
      entityId: reportId,
      details: { reason: voidReason, reissueId },
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });
  return reissueId;
}

async function listReportUsages(db: SQLiteDatabase, reportId: string): Promise<ServiceReportUsage[]> {
  const rows = await db.getAllAsync<UsageRow>(
    `SELECT u.id, u.item_id, u.description_snapshot AS item_name, i.sku AS item_sku, i.unit_label,
            u.quantity_integer, u.billable, u.resolved_selling_price_centavos,
            u.price_source, u.override_reason,
            COALESCE((SELECT SUM(m.quantity_delta_integer) FROM inventory_movements m WHERE m.item_id = i.id), 0) AS current_stock
     FROM service_report_item_usage u
     JOIN items i ON i.id = u.item_id
     WHERE u.service_report_id = ?
     ORDER BY u.created_at ASC`,
    reportId,
  );
  return rows.map(mapUsageRow);
}

export async function listReportMachineServices(db: SQLiteDatabase, reportId: string): Promise<ServiceReportMachineService[]> {
  const rows = await db.getAllAsync<MachineServiceRow>(
    `SELECT id, equipment_id, service_id, description_snapshot, machine_label, rate_centavos, rate_source, note
     FROM service_report_machine_service
     WHERE service_report_id = ?
     ORDER BY created_at ASC, rowid ASC`,
    reportId,
  );
  return rows.map((row) => ({
    id: row.id,
    equipmentId: row.equipment_id,
    machineLabel: row.machine_label,
    serviceId: row.service_id,
    serviceName: row.description_snapshot,
    rateCentavos: row.rate_centavos,
    rateSource: row.rate_source,
    note: row.note,
  }));
}

async function listFinalizationUsages(
  db: SQLiteDatabase,
  reportId: string,
  customerId: string,
): Promise<FinalizationUsageRow[]> {
  return db.getAllAsync<FinalizationUsageRow>(
    `SELECT u.id, u.item_id, u.description_snapshot AS item_name, i.sku AS item_sku, i.unit_label,
            u.quantity_integer, u.billable, u.resolved_selling_price_centavos,
            u.price_source, u.override_reason, i.base_selling_price_centavos,
            p.selling_price_centavos AS customer_price_centavos,
            COALESCE((SELECT SUM(m.quantity_delta_integer) FROM inventory_movements m WHERE m.item_id = i.id), 0) AS current_stock
     FROM service_report_item_usage u
     JOIN items i ON i.id = u.item_id
     LEFT JOIN customer_item_prices p
       ON p.item_id = i.id AND p.customer_id = ? AND p.effective_to IS NULL
     WHERE u.service_report_id = ?
     ORDER BY u.created_at ASC`,
    customerId,
    reportId,
  );
}

function mapSummaryRow(row: SummaryRow): ServiceReportSummary {
  return {
    id: row.id,
    csrNumber: row.csr_number,
    customerName: row.customer_name,
    equipmentName: row.equipment_name,
    documentState: row.document_state,
    serviceOutcome: row.service_outcome,
    businessDate: row.business_date,
    pdfState: row.pdf_state,
    totalBillCentavos: row.total_bill_centavos,
    linkedStatements: [],
  };
}

function mapDetailRow(row: DetailRow): Omit<ServiceReportDetail, 'usages' | 'machineServices' | 'machines' | 'machineCount'> {
  return {
    ...mapSummaryRow(row),
    customerId: row.customer_id,
    equipmentId: row.equipment_id,
    followsCsrId: row.follows_csr_id,
    reportedProblem: parseEntries(row.reported_problem_json),
    diagnosis: parseEntries(row.diagnosis_json),
    actionTaken: parseEntries(row.action_taken_json),
    recommendations: parseEntries(row.recommendations_json),
    billing: parseEntries(row.billing_json),
    customerRemarks: parseEntries(row.customer_remarks_json),
    machineStatus: row.machine_status,
    warrantyText: row.warranty_text,
    servicedBy: row.serviced_by_snapshot,
    acknowledgedBy: row.acknowledged_by_snapshot,
    totalBillCentavos: row.total_bill_centavos,
    signatureStatus: row.signature_status === 'signed_document_attached'
      ? row.signature_status
      : row.has_signed_version === 1 ? 'signed_in_person' : row.signature_status,
    hasSignedVersion: row.has_signed_version === 1,
    shareState: row.share_state,
    finalizedAt: row.finalized_at,
    customerType: row.customer_type,
    acknowledgmentOptions: [],
  };
}

function mapUsageRow(row: UsageRow): ServiceReportUsage {
  return {
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    itemSku: row.item_sku,
    unitLabel: row.unit_label,
    quantity: row.quantity_integer,
    currentStock: row.current_stock,
    billable: row.billable === 1,
    resolvedSellingPriceCentavos: row.resolved_selling_price_centavos,
    priceSource: row.price_source,
    overrideReason: row.override_reason,
  };
}

function cleanEntries(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function parseEntries(value: string): string[] {
  try {
    const result: unknown = JSON.parse(value);
    return Array.isArray(result) ? result.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function assertNonNegativeMoney(value: number, label = 'Amount'): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative amount.`);
}
