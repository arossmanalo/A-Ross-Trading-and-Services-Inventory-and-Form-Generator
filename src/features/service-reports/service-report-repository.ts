import { getBusinessLogo } from '@/features/settings/settings-repository';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { allocateDocumentNumber } from '@/db/sequences';
import { getLocalBusinessDate, validateBusinessDate } from '@/domain/business-date';
import { assertPositiveIntegerQuantity } from '@/domain/stock';
import { buildCsrHtml, CSR_TEMPLATE_VERSION, type CsrRenderSnapshot } from '@/features/service-reports/csr-template';
import { getPreparerSignatureHtml } from '@/features/signatures/capture-repository';
import { calculateServiceReportTotal } from '@/features/service-reports/service-report-total';
import type {
  CreateServiceReportDraftInput,
  DocumentState,
  ServiceOutcome,
  ServiceReportDetail,
  ServiceReportServiceUsage,
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
};

type DetailRow = SummaryRow & {
  customer_id: string;
  equipment_id: string;
  follows_csr_id: string | null;
  backdate_reason: string | null;
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
  share_state: 'not_shared' | 'shared';
  finalized_at: string | null;
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

type ServiceUsageRow = {
  id: string;
  service_id: string;
  service_name: string;
  quantity_integer: number;
  resolved_rate_centavos: number;
  rate_source: ServiceReportServiceUsage['rateSource'];
  override_reason: string | null;
};

type FinalizationServiceUsageRow = ServiceUsageRow & {
  base_rate_centavos: number;
};

export class DraftPriceChangedError extends Error {
  constructor(readonly itemNames: string[]) {
    super(`Pricing changed for: ${itemNames.join(', ')}. Choose which prices to retain.`);
    this.name = 'DraftPriceChangedError';
  }
}

export async function listServiceReports(db: SQLiteDatabase): Promise<ServiceReportSummary[]> {
  const rows = await db.getAllAsync<SummaryRow>(
    `SELECT r.id, r.csr_number, c.name AS customer_name,
            e.machine_type AS equipment_name, r.document_state,
            r.service_outcome, r.business_date, r.pdf_state
     FROM service_reports r
     JOIN customers c ON c.id = r.customer_id
     JOIN customer_equipment e ON e.id = r.equipment_id
     ORDER BY r.created_at DESC`,
  );
  return rows.map(mapSummaryRow);
}

export async function getServiceReport(
  db: SQLiteDatabase,
  reportId: string,
): Promise<ServiceReportDetail | null> {
  const row = await db.getFirstAsync<DetailRow>(
    `SELECT r.*, c.name AS customer_name, e.machine_type AS equipment_name
     FROM service_reports r
     JOIN customers c ON c.id = r.customer_id
     JOIN customer_equipment e ON e.id = r.equipment_id
     WHERE r.id = ?`,
    reportId,
  );
  if (!row) return null;
  const usages = await listReportUsages(db, reportId);
  const services = await listReportServices(db, reportId);
  const detail = mapDetailRow(row);
  return {
    ...detail,
    totalBillCentavos: row.document_state === 'draft'
      ? calculateServiceReportTotal(usages, services)
      : detail.totalBillCentavos,
    usages,
    services,
  };
}

export async function createServiceReportDraft(
  db: SQLiteDatabase,
  input: CreateServiceReportDraftInput,
): Promise<string> {
  validateBusinessDate(input.businessDate, input.backdateReason);
  const reportId = Crypto.randomUUID();
  const now = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (tx) => {
    const equipment = await tx.getFirstAsync<{
      customer_id: string;
      customer_active: number;
      equipment_active: number;
    }>(
      `SELECT e.customer_id, c.active AS customer_active, e.active AS equipment_active
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

    if (input.followsCsrId) {
      const previous = await tx.getFirstAsync<{ customer_id: string; equipment_id: string; document_state: string }>(
        'SELECT customer_id, equipment_id, document_state FROM service_reports WHERE id = ?',
        input.followsCsrId,
      );
      if (!previous || previous.document_state !== 'finalized') {
        throw new Error('A follow-up must reference a finalized CSR.');
      }
      if (previous.customer_id !== input.customerId || previous.equipment_id !== input.equipmentId) {
        throw new Error('A follow-up must use the same customer and equipment.');
      }
    }

    await tx.runAsync(
      `INSERT INTO service_reports
        (id, customer_id, equipment_id, follows_csr_id, business_date,
         backdate_reason, document_state, service_outcome, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', 'incomplete', ?)`,
      reportId,
      input.customerId,
      input.equipmentId,
      input.followsCsrId ?? null,
      input.businessDate,
      input.backdateReason?.trim() || null,
      now,
    );
    await appendAuditEvent(tx, {
      eventType: input.followsCsrId ? 'csr.follow_up_draft_created' : 'csr.draft_created',
      entityType: 'service_report',
      entityId: reportId,
      details: { followsCsrId: input.followsCsrId ?? null },
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });
  return reportId;
}

export async function updateServiceReportDraft(
  db: SQLiteDatabase,
  reportId: string,
  input: UpdateServiceReportDraftInput,
): Promise<void> {
  validateBusinessDate(input.businessDate, input.backdateReason);
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const update = await tx.runAsync(
      `UPDATE service_reports
       SET service_outcome = ?, business_date = ?, backdate_reason = ?,
           reported_problem_json = ?, diagnosis_json = ?, action_taken_json = ?,
           recommendations_json = ?, billing_json = ?, customer_remarks_json = ?,
           machine_status = ?, warranty_text = ?, serviced_by_snapshot = ?,
           acknowledged_by_snapshot = ?
       WHERE id = ? AND document_state = 'draft'`,
      input.serviceOutcome,
      input.businessDate,
      input.backdateReason?.trim() || null,
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

export async function addReportItemUsage(
  db: SQLiteDatabase,
  reportId: string,
  itemId: string,
  quantity: number,
  billable: boolean,
): Promise<string> {
  assertPositiveIntegerQuantity(quantity);
  const usageId = Crypto.randomUUID();
  const now = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (tx) => {
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
    const price = item.customer_price_centavos ?? item.base_selling_price_centavos;
    const source = item.customer_price_centavos === null ? 'base' : 'customer';
    try {
      await tx.runAsync(
        `INSERT INTO service_report_item_usage
          (id, service_report_id, item_id, quantity_integer, billable,
           resolved_selling_price_centavos, price_source, description_snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        usageId,
        reportId,
        itemId,
        quantity,
        billable ? 1 : 0,
        billable ? price : null,
        billable ? source : null,
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
  });
  return usageId;
}

export async function removeReportItemUsage(
  db: SQLiteDatabase,
  reportId: string,
  usageId: string,
): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const result = await tx.runAsync(
      `DELETE FROM service_report_item_usage
       WHERE id = ? AND service_report_id = ?
         AND EXISTS (SELECT 1 FROM service_reports WHERE id = ? AND document_state = 'draft')`,
      usageId,
      reportId,
      reportId,
    );
    if (result.changes !== 1) throw new Error('Only draft item usage can be removed.');
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

export async function addReportServiceUsage(
  db: SQLiteDatabase,
  reportId: string,
  serviceId: string,
  overrideRateCentavos?: number,
  overrideReason?: string,
): Promise<string> {
  if (overrideRateCentavos !== undefined) assertNonNegativeMoney(overrideRateCentavos, 'Service rate');
  const reason = overrideReason?.trim() || null;
  const usageId = Crypto.randomUUID();
  const now = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (tx) => {
    const report = await tx.getFirstAsync<{ id: string }>(
      "SELECT id FROM service_reports WHERE id = ? AND document_state = 'draft'",
      reportId,
    );
    if (!report) throw new Error('Only a draft CSR can accept service usage.');
    const service = await tx.getFirstAsync<{
      name: string;
      active: number;
      base_rate_centavos: number;
    }>('SELECT name, active, base_rate_centavos FROM services WHERE id = ?', serviceId);
    if (!service || service.active !== 1) throw new Error('Select an active service.');
    const rate = overrideRateCentavos ?? service.base_rate_centavos;
    const isOverride = overrideRateCentavos !== undefined && overrideRateCentavos !== service.base_rate_centavos;
    if (isOverride && !reason) throw new Error('A reason is required when overriding a service rate.');
    try {
      await tx.runAsync(
        `INSERT INTO service_report_service_usage
          (id, service_report_id, service_id, quantity_integer, resolved_rate_centavos,
           rate_source, override_reason, description_snapshot, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        usageId,
        reportId,
        serviceId,
        rate,
        isOverride ? 'override' : 'catalog',
        isOverride ? reason : null,
        service.name,
        now,
      );
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new Error('This service is already listed on the CSR.');
      throw error;
    }
    await recalculateServiceReportTotal(tx, reportId);
    await appendAuditEvent(tx, {
      eventType: 'csr.service_usage_added',
      entityType: 'service_report',
      entityId: reportId,
      details: { serviceId, rateCentavos: rate, overridden: isOverride },
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });
  return usageId;
}

export async function removeReportServiceUsage(
  db: SQLiteDatabase,
  reportId: string,
  usageId: string,
): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const result = await tx.runAsync(
      `DELETE FROM service_report_service_usage
       WHERE id = ? AND service_report_id = ?
         AND EXISTS (SELECT 1 FROM service_reports WHERE id = ? AND document_state = 'draft')`,
      usageId,
      reportId,
      reportId,
    );
    if (result.changes !== 1) throw new Error('Only draft service usage can be removed.');
    await recalculateServiceReportTotal(tx, reportId);
    await appendAuditEvent(tx, {
      eventType: 'csr.service_usage_removed',
      entityType: 'service_report',
      entityId: reportId,
      createdAt: new Date().toISOString(),
    });
    await incrementDatabaseRevision(tx);
  });
}

export async function deleteServiceReportDraft(
  db: SQLiteDatabase,
  reportId: string,
): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const draft = await tx.getFirstAsync<{ id: string }>(
      "SELECT id FROM service_reports WHERE id = ? AND document_state = 'draft'",
      reportId,
    );
    if (!draft) throw new Error('Only an unnumbered draft can be deleted.');
    await tx.runAsync('DELETE FROM service_report_item_usage WHERE service_report_id = ?', reportId);
    await tx.runAsync('DELETE FROM service_report_service_usage WHERE service_report_id = ?', reportId);
    await tx.runAsync("DELETE FROM service_reports WHERE id = ? AND document_state = 'draft'", reportId);
    await appendAuditEvent(tx, {
      eventType: 'csr.draft_deleted',
      entityType: 'service_report',
      entityId: reportId,
      createdAt: new Date().toISOString(),
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
    validateBusinessDate(row.business_date, row.backdate_reason ?? undefined);

    let usages = await listFinalizationUsages(tx, reportId, row.customer_id);
    let services = await listFinalizationServices(tx, reportId);
    const priceChanges: string[] = [];
    for (const usage of usages) {
      if (usage.quantity_integer > usage.current_stock) {
        throw new Error(`${usage.item_name}: only ${usage.current_stock} available, ${usage.quantity_integer} required.`);
      }
      if (usage.billable === 1) {
        const currentPrice = usage.customer_price_centavos ?? usage.base_selling_price_centavos;
        if (usage.resolved_selling_price_centavos !== currentPrice) priceChanges.push(usage.item_name);
      }
    }
    for (const service of services) {
      if (service.rate_source !== 'override' && service.resolved_rate_centavos !== service.base_rate_centavos) {
        priceChanges.push(service.service_name);
      }
    }
    if (priceChanges.length && pricePolicy === 'reject') throw new DraftPriceChangedError(priceChanges);

    for (const usage of usages) {
      if (usage.billable !== 1) continue;
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
    for (const service of services) {
      if (service.rate_source === 'override') continue;
      if (pricePolicy === 'use-current') {
        await tx.runAsync(
          `UPDATE service_report_service_usage
           SET resolved_rate_centavos = ?, rate_source = 'catalog', override_reason = NULL
           WHERE id = ?`,
          service.base_rate_centavos,
          service.id,
        );
      } else if (pricePolicy === 'keep-draft' && service.resolved_rate_centavos !== service.base_rate_centavos) {
        await tx.runAsync(
          `UPDATE service_report_service_usage
           SET rate_source = 'override', override_reason = 'Draft rate retained after rate change'
           WHERE id = ?`,
          service.id,
        );
      }
    }
    usages = await listFinalizationUsages(tx, reportId, row.customer_id);
    services = await listFinalizationServices(tx, reportId);
    const totalBillCentavos = calculateServiceReportTotal(usages.map((usage) => ({
      quantity: usage.quantity_integer,
      billable: usage.billable === 1,
      resolvedSellingPriceCentavos: usage.resolved_selling_price_centavos,
    })), services.map((service) => ({ resolvedRateCentavos: service.resolved_rate_centavos })));
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
      services: services.map((service) => ({
        description: service.service_name,
        rateCentavos: service.resolved_rate_centavos,
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
       JOIN service_report_item_usage u ON u.id = l.source_csr_usage_id
       JOIN billing_statements b ON b.id = l.billing_statement_id
       WHERE u.service_report_id = ? AND b.document_state <> 'voided'`,
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
    `SELECT u.id, u.item_id, i.name AS item_name, i.sku AS item_sku, i.unit_label,
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

async function listReportServices(db: SQLiteDatabase, reportId: string): Promise<ServiceReportServiceUsage[]> {
  const rows = await db.getAllAsync<ServiceUsageRow>(
    `SELECT u.id, u.service_id, COALESCE(u.description_snapshot, s.name) AS service_name,
            u.quantity_integer, u.resolved_rate_centavos, u.rate_source, u.override_reason
     FROM service_report_service_usage u
     JOIN services s ON s.id = u.service_id
     WHERE u.service_report_id = ?
     ORDER BY u.created_at ASC`,
    reportId,
  );
  return rows.map(mapServiceUsageRow);
}

async function listFinalizationUsages(
  db: SQLiteDatabase,
  reportId: string,
  customerId: string,
): Promise<FinalizationUsageRow[]> {
  return db.getAllAsync<FinalizationUsageRow>(
    `SELECT u.id, u.item_id, i.name AS item_name, i.sku AS item_sku, i.unit_label,
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

async function listFinalizationServices(
  db: SQLiteDatabase,
  reportId: string,
): Promise<FinalizationServiceUsageRow[]> {
  return db.getAllAsync<FinalizationServiceUsageRow>(
    `SELECT u.id, u.service_id, COALESCE(u.description_snapshot, s.name) AS service_name,
            u.quantity_integer, u.resolved_rate_centavos, u.rate_source, u.override_reason,
            s.base_rate_centavos
     FROM service_report_service_usage u
     JOIN services s ON s.id = u.service_id
     WHERE u.service_report_id = ?
     ORDER BY u.created_at ASC`,
    reportId,
  );
}

async function recalculateServiceReportTotal(
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
    db.getAllAsync<{ resolved_rate_centavos: number }>(
      `SELECT resolved_rate_centavos
       FROM service_report_service_usage WHERE service_report_id = ?`,
      reportId,
    ),
  ]);
  const total = calculateServiceReportTotal(
    items.map((item) => ({
      quantity: item.quantity_integer,
      billable: item.billable === 1,
      resolvedSellingPriceCentavos: item.resolved_selling_price_centavos,
    })),
    services.map((service) => ({ resolvedRateCentavos: service.resolved_rate_centavos })),
  );
  await db.runAsync(
    "UPDATE service_reports SET total_bill_centavos = ? WHERE id = ? AND document_state = 'draft'",
    total,
    reportId,
  );
  return total;
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
  };
}

function mapDetailRow(row: DetailRow): Omit<ServiceReportDetail, 'usages' | 'services'> {
  return {
    ...mapSummaryRow(row),
    customerId: row.customer_id,
    equipmentId: row.equipment_id,
    followsCsrId: row.follows_csr_id,
    backdateReason: row.backdate_reason,
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
    signatureStatus: row.signature_status,
    shareState: row.share_state,
    finalizedAt: row.finalized_at,
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

function mapServiceUsageRow(row: ServiceUsageRow): ServiceReportServiceUsage {
  return {
    id: row.id,
    serviceId: row.service_id,
    serviceName: row.service_name,
    quantity: 1,
    resolvedRateCentavos: row.resolved_rate_centavos,
    rateSource: row.rate_source,
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
