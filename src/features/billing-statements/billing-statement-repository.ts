import { getBusinessLogo } from '@/features/settings/settings-repository';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { allocateDocumentNumber } from '@/db/sequences';
import { validateBusinessDate } from '@/domain/business-date';
import { calculateDiscountCentavos, type Discount } from '@/domain/money';
import { assertPositiveIntegerQuantity } from '@/domain/stock';
import { BILLING_STATEMENT_TEMPLATE_VERSION, buildBillingStatementHtml, type BillingStatementRenderSnapshot } from '@/features/billing-statements/billing-statement-template';
import { getPreparerSignatureHtml } from '@/features/signatures/capture-repository';
import type { BillingDiscountType, BillingDocumentState, BillingExpense, BillingPriceSource, BillingStatementDetail, BillingStatementLine, BillingStatementSummary, EligibleCsrUsage } from '@/features/billing-statements/billing-statement-types';
import { createInitialPaymentRecord, type PaymentRenderResult } from '@/features/payments/payment-repository';
import type { InitialPaymentSelection } from '@/features/payments/payment-types';

type SummaryRow = { id: string; bs_number: string | null; customer_name: string; document_state: BillingDocumentState; business_date: string; discounted_total_centavos: number; pdf_state: BillingStatementSummary['pdfState'] };
type DetailRow = SummaryRow & { customer_id: string; customer_address: string; service_report_id: string | null; csr_number: string | null; backdate_reason: string | null; subtotal_centavos: number; discount_type: BillingDiscountType; discount_value: number; payment_choice: BillingStatementDetail['paymentChoice']; share_state: 'not_shared' | 'shared'; finalized_at: string | null };
type LineRow = { id: string; line_type: BillingStatementLine['lineType']; source_csr_usage_id: string | null; item_id: string | null; service_id: string | null; expense_id: string | null; description_snapshot: string; quantity_integer: number; unit_price_centavos: number; amount_centavos: number; price_source: BillingPriceSource | null; override_reason: string | null };
type ExpenseRow = { id: string; description: string; actual_cost_centavos: number; billable: number; billed_amount_centavos: number | null };
type FinalLineRow = LineRow & { unit_label: string | null; item_active: number | null; current_stock: number | null; base_selling_price_centavos: number | null; customer_price_centavos: number | null; service_active: number | null; base_rate_centavos: number | null };

export class BillingDraftPriceChangedError extends Error {
  constructor(readonly lineNames: string[]) {
    super(`Pricing changed for: ${lineNames.join(', ')}. Choose which prices to retain.`);
    this.name = 'BillingDraftPriceChangedError';
  }
}

export async function listBillingStatements(db: SQLiteDatabase): Promise<BillingStatementSummary[]> {
  const rows = await db.getAllAsync<SummaryRow>(`SELECT b.id,b.bs_number,c.name AS customer_name,b.document_state,b.business_date,b.discounted_total_centavos,b.pdf_state FROM billing_statements b JOIN customers c ON c.id=b.customer_id ORDER BY b.created_at DESC`);
  return rows.map(mapSummary);
}

export async function getBillingStatement(db: SQLiteDatabase, statementId: string): Promise<BillingStatementDetail | null> {
  const row = await db.getFirstAsync<DetailRow>(`SELECT b.*,c.name AS customer_name,c.address AS customer_address,r.csr_number FROM billing_statements b JOIN customers c ON c.id=b.customer_id LEFT JOIN service_reports r ON r.id=b.service_report_id WHERE b.id=?`, statementId);
  if (!row) return null;
  const [lines, expenses] = await Promise.all([listLines(db, statementId), listExpenses(db, statementId)]);
  return { ...mapSummary(row), customerId: row.customer_id, customerAddress: row.customer_address, serviceReportId: row.service_report_id, serviceReportNumber: row.csr_number, backdateReason: row.backdate_reason, subtotalCentavos: row.subtotal_centavos, discountType: row.discount_type, discountValue: row.discount_value, paymentChoice: row.payment_choice, shareState: row.share_state, finalizedAt: row.finalized_at, lines, expenses };
}

export async function listFinalizedCsrsForCustomer(db: SQLiteDatabase, customerId: string): Promise<Array<{ id: string; csrNumber: string; businessDate: string; availableLineCount: number }>> {
  const rows = await db.getAllAsync<{ id: string; csr_number: string; business_date: string; available_line_count: number }>(`SELECT r.id,r.csr_number,r.business_date,COUNT(u.id) AS available_line_count FROM service_reports r LEFT JOIN service_report_item_usage u ON u.service_report_id=r.id AND u.billable=1 AND NOT EXISTS(SELECT 1 FROM billing_statement_lines l WHERE l.source_csr_usage_id=u.id) WHERE r.customer_id=? AND r.document_state='finalized' GROUP BY r.id ORDER BY r.business_date DESC,r.finalized_at DESC`, customerId);
  return rows.map((row) => ({ id: row.id, csrNumber: row.csr_number, businessDate: row.business_date, availableLineCount: row.available_line_count }));
}

export async function createBillingStatementDraft(db: SQLiteDatabase, input: { customerId: string; serviceReportId?: string; businessDate: string; backdateReason?: string }): Promise<string> {
  validateBusinessDate(input.businessDate, input.backdateReason);
  const id = Crypto.randomUUID(); const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const customer = await tx.getFirstAsync<{ active: number; merged_into_customer_id: string | null }>('SELECT active,merged_into_customer_id FROM customers WHERE id=?', input.customerId);
    if (!customer || customer.active !== 1 || customer.merged_into_customer_id) throw new Error('Select an active registered customer.');
    if (input.serviceReportId) {
      const report = await tx.getFirstAsync<{ customer_id: string; document_state: string }>('SELECT customer_id,document_state FROM service_reports WHERE id=?', input.serviceReportId);
      if (!report || report.document_state !== 'finalized' || report.customer_id !== input.customerId) throw new Error('Select a finalized CSR for the same customer.');
    }
    await tx.runAsync(`INSERT INTO billing_statements(id,customer_id,service_report_id,business_date,backdate_reason,document_state,created_at) VALUES(?,?,?,?,?,'draft',?)`, id, input.customerId, input.serviceReportId ?? null, input.businessDate, input.backdateReason?.trim() || null, now);
    await auditAndRevise(tx, 'billing_statement.draft_created', id, { serviceReportId: input.serviceReportId ?? null }, now);
  });
  return id;
}

export async function updateBillingStatementDraft(db: SQLiteDatabase, statementId: string, input: { businessDate: string; backdateReason?: string; discountType: BillingDiscountType; discountValue: number }): Promise<void> {
  validateBusinessDate(input.businessDate, input.backdateReason);
  if (!Number.isSafeInteger(input.discountValue) || input.discountValue < 0) throw new Error('Discount must be non-negative.');
  if (input.discountType === 'percentage' && input.discountValue > 10_000) throw new Error('Percentage discount cannot exceed 100%.');
  await db.withExclusiveTransactionAsync(async (tx) => {
    const subtotal = await getSubtotal(tx, statementId);
    const discount = toDiscount(input.discountType, input.discountValue);
    const discountCentavos = calculateDiscountCentavos(subtotal, discount);
    const result = await tx.runAsync(`UPDATE billing_statements SET business_date=?,backdate_reason=?,discount_type=?,discount_value=?,subtotal_centavos=?,discounted_total_centavos=? WHERE id=? AND document_state='draft'`, input.businessDate, input.backdateReason?.trim() || null, input.discountType, input.discountType ? input.discountValue : 0, subtotal, subtotal - discountCentavos, statementId);
    if (result.changes !== 1) throw new Error('Only a draft billing statement can be edited.');
    await auditAndRevise(tx, 'billing_statement.draft_saved', statementId, { discountCentavos }, new Date().toISOString());
  });
}

export async function listEligibleCsrUsages(db: SQLiteDatabase, statementId: string): Promise<EligibleCsrUsage[]> {
  const rows = await db.getAllAsync<{ id: string; csr_number: string; item_name: string; quantity_integer: number; unit_label: string; unit_price: number }>(`SELECT u.id,r.csr_number,u.description_snapshot AS item_name,u.quantity_integer,i.unit_label,u.resolved_selling_price_centavos AS unit_price FROM billing_statements b JOIN service_reports r ON r.id=b.service_report_id JOIN service_report_item_usage u ON u.service_report_id=r.id JOIN items i ON i.id=u.item_id WHERE b.id=? AND b.document_state='draft' AND u.billable=1 AND u.resolved_selling_price_centavos IS NOT NULL AND NOT EXISTS(SELECT 1 FROM billing_statement_lines l WHERE l.source_csr_usage_id=u.id) ORDER BY u.created_at`, statementId);
  return rows.map((row) => ({ id: row.id, csrNumber: row.csr_number, itemName: row.item_name, quantity: row.quantity_integer, unitLabel: row.unit_label, unitPriceCentavos: row.unit_price, amountCentavos: safeMultiply(row.unit_price, row.quantity_integer) }));
}

export async function addCsrUsageLine(db: SQLiteDatabase, statementId: string, usageId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ description_snapshot: string; quantity_integer: number; resolved_selling_price_centavos: number; price_source: BillingPriceSource; item_id: string }>(`SELECT u.description_snapshot,u.quantity_integer,u.resolved_selling_price_centavos,u.price_source,u.item_id FROM billing_statements b JOIN service_report_item_usage u ON u.service_report_id=b.service_report_id WHERE b.id=? AND b.document_state='draft' AND u.id=? AND u.billable=1`, statementId, usageId);
    if (!row || row.resolved_selling_price_centavos === null) throw new Error('This CSR line is not eligible for billing.');
    try { await tx.runAsync(`INSERT INTO billing_statement_lines(id,billing_statement_id,line_type,source_csr_usage_id,item_id,description_snapshot,quantity_integer,unit_price_centavos,amount_centavos,price_source,override_reason,created_at) VALUES(?,?,'item',?,?,?,?,?,?,?,?,?)`, Crypto.randomUUID(), statementId, usageId, row.item_id, row.description_snapshot, row.quantity_integer, row.resolved_selling_price_centavos, safeMultiply(row.resolved_selling_price_centavos,row.quantity_integer), row.price_source, null, now); }
    catch (error) { if (String(error).includes('UNIQUE')) throw new Error('This CSR item has already been billed.'); throw error; }
    await refreshTotals(tx, statementId); await auditAndRevise(tx, 'billing_statement.csr_line_added', statementId, { usageId }, now);
  });
}

export async function addDirectItemLine(db: SQLiteDatabase, statementId: string, input: { itemId: string; quantity: number; unitPriceCentavos?: number; overrideReason?: string }): Promise<void> {
  assertPositiveIntegerQuantity(input.quantity); const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ customer_id: string; name: string; active: number; base_selling_price_centavos: number; customer_price_centavos: number | null }>(`SELECT b.customer_id,i.name,i.active,i.base_selling_price_centavos,p.selling_price_centavos AS customer_price_centavos FROM billing_statements b JOIN items i ON i.id=? LEFT JOIN customer_item_prices p ON p.item_id=i.id AND p.customer_id=b.customer_id AND p.effective_to IS NULL WHERE b.id=? AND b.document_state='draft'`, input.itemId, statementId);
    if (!row || row.active !== 1) throw new Error('Select an active item for a draft statement.');
    const resolved = row.customer_price_centavos ?? row.base_selling_price_centavos;
    const price = input.unitPriceCentavos ?? resolved; assertMoney(price, 'Unit price');
    const overridden = price !== resolved; const reason = input.overrideReason?.trim() || null;
    if (overridden && !reason) throw new Error('A reason is required when overriding the resolved item price.');
    await tx.runAsync(`INSERT INTO billing_statement_lines(id,billing_statement_id,line_type,item_id,description_snapshot,quantity_integer,unit_price_centavos,amount_centavos,price_source,override_reason,created_at) VALUES(?,?,'item',?,?,?,?,?,?,?,?)`, Crypto.randomUUID(), statementId, input.itemId, row.name, input.quantity, price, safeMultiply(price,input.quantity), overridden ? 'override' : row.customer_price_centavos === null ? 'base' : 'customer', reason, now);
    await refreshTotals(tx, statementId); await auditAndRevise(tx, 'billing_statement.direct_item_added', statementId, { itemId: input.itemId, quantity: input.quantity, overridden }, now);
  });
}

export async function addServiceLine(db: SQLiteDatabase, statementId: string, input: { serviceId: string; rateCentavos?: number; overrideReason?: string }): Promise<void> {
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ name: string; active: number; base_rate_centavos: number }>(`SELECT s.name,s.active,s.base_rate_centavos FROM billing_statements b JOIN services s ON s.id=? WHERE b.id=? AND b.document_state='draft'`, input.serviceId, statementId);
    if (!row || row.active !== 1) throw new Error('Select an active service for a draft statement.');
    const rate = input.rateCentavos ?? row.base_rate_centavos; assertMoney(rate, 'Service rate');
    const overridden = rate !== row.base_rate_centavos; const reason = input.overrideReason?.trim() || null;
    if (overridden && !reason) throw new Error('A reason is required when changing the catalog rate.');
    await tx.runAsync(`INSERT INTO billing_statement_lines(id,billing_statement_id,line_type,service_id,description_snapshot,quantity_integer,unit_price_centavos,amount_centavos,price_source,override_reason,created_at) VALUES(?,?,'service',?,?,1,?,?,?,?,?)`, Crypto.randomUUID(), statementId, input.serviceId, row.name, rate, rate, overridden ? 'override' : 'catalog', reason, now);
    await refreshTotals(tx, statementId); await auditAndRevise(tx, 'billing_statement.service_added', statementId, { serviceId: input.serviceId, overridden }, now);
  });
}

export async function addStatementExpense(db: SQLiteDatabase, statementId: string, input: { description: string; actualCostCentavos: number; billable: boolean; billedAmountCentavos?: number }): Promise<void> {
  const description = input.description.trim(); if (!description) throw new Error('Expense description is required.');
  assertMoney(input.actualCostCentavos, 'Actual cost');
  const billed = input.billable ? input.billedAmountCentavos ?? input.actualCostCentavos : null;
  if (billed !== null) assertMoney(billed, 'Billed amount');
  const now = new Date().toISOString(); const expenseId = Crypto.randomUUID();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const statement = await tx.getFirstAsync<{ customer_id: string; service_report_id: string | null; business_date: string }>("SELECT customer_id,service_report_id,business_date FROM billing_statements WHERE id=? AND document_state='draft'", statementId);
    if (!statement) throw new Error('Only a draft statement can accept expenses.');
    await tx.runAsync(`INSERT INTO expenses(id,customer_id,service_report_id,billing_statement_id,description,business_date,actual_cost_centavos,billable,billed_amount_centavos,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, expenseId, statement.customer_id, statement.service_report_id, statementId, description, statement.business_date, input.actualCostCentavos, input.billable ? 1 : 0, billed, now);
    if (input.billable && billed !== null) await tx.runAsync(`INSERT INTO billing_statement_lines(id,billing_statement_id,line_type,expense_id,description_snapshot,quantity_integer,unit_price_centavos,amount_centavos,price_source,created_at) VALUES(?,?,'expense',?,?,1,?,?, 'expense',?)`, Crypto.randomUUID(), statementId, expenseId, description, billed, billed, now);
    await refreshTotals(tx, statementId); await auditAndRevise(tx, 'billing_statement.expense_added', statementId, { billable: input.billable, actualCostCentavos: input.actualCostCentavos }, now);
  });
}

export async function removeBillingLine(db: SQLiteDatabase, statementId: string, lineId: string): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => {
    const line = await tx.getFirstAsync<{ expense_id: string | null }>(`SELECT l.expense_id FROM billing_statement_lines l JOIN billing_statements b ON b.id=l.billing_statement_id WHERE l.id=? AND l.billing_statement_id=? AND b.document_state='draft'`, lineId, statementId);
    if (!line) throw new Error('Only draft charges can be removed.');
    await tx.runAsync('DELETE FROM billing_statement_lines WHERE id=?', lineId);
    if (line.expense_id) await tx.runAsync('DELETE FROM expenses WHERE id=?', line.expense_id);
    await refreshTotals(tx, statementId); await auditAndRevise(tx, 'billing_statement.line_removed', statementId, {}, new Date().toISOString());
  });
}

export async function removeNonbillableExpense(db: SQLiteDatabase, statementId: string, expenseId: string): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => { const result = await tx.runAsync(`DELETE FROM expenses WHERE id=? AND billing_statement_id=? AND billable=0 AND EXISTS(SELECT 1 FROM billing_statements WHERE id=? AND document_state='draft')`, expenseId, statementId, statementId); if (result.changes !== 1) throw new Error('Only a draft non-chargeable expense can be removed.'); await auditAndRevise(tx, 'billing_statement.expense_removed', statementId, {}, new Date().toISOString()); });
}

export async function deleteBillingStatementDraft(db: SQLiteDatabase, statementId: string): Promise<void> {
  await db.withExclusiveTransactionAsync(async (tx) => { const draft = await tx.getFirstAsync<{ id: string }>("SELECT id FROM billing_statements WHERE id=? AND document_state='draft'", statementId); if (!draft) throw new Error('Only an unnumbered draft can be deleted.'); await tx.runAsync('DELETE FROM billing_statement_lines WHERE billing_statement_id=?',statementId); await tx.runAsync('DELETE FROM expenses WHERE billing_statement_id=?',statementId); await tx.runAsync('DELETE FROM billing_statements WHERE id=?',statementId); await auditAndRevise(tx,'billing_statement.draft_deleted',statementId,{},new Date().toISOString()); });
}

export async function finalizeBillingStatement(db: SQLiteDatabase, statementId: string, pricePolicy: 'keep-draft' | 'reject' | 'use-current' = 'reject', paymentSelection: InitialPaymentSelection = { choice: 'pay_later' }): Promise<{ bsNumber: string; html: string; snapshot: BillingStatementRenderSnapshot; initialPayment: PaymentRenderResult | null }> {
  let result: { bsNumber: string; html: string; snapshot: BillingStatementRenderSnapshot; initialPayment: PaymentRenderResult | null } | null = null;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<DetailRow & { business_name: string; business_address: string; contact_details: string; vat_display_mode: BillingStatementRenderSnapshot['vatDisplayMode']; vat_rate_basis_points: number; content_snapshot_json: string | null; render_template_snapshot: string | null }>(`SELECT b.*,c.name AS customer_name,c.address AS customer_address,r.csr_number,s.business_name,s.business_address,s.contact_details,s.vat_display_mode,s.vat_rate_basis_points FROM billing_statements b JOIN customers c ON c.id=b.customer_id LEFT JOIN service_reports r ON r.id=b.service_report_id JOIN settings s ON s.id='business' WHERE b.id=?`, statementId);
    if (!row) throw new Error('Billing statement was not found.');
    if (row.document_state === 'finalized') { if (!row.bs_number || !row.content_snapshot_json || !row.render_template_snapshot) throw new Error('Finalized statement snapshot is incomplete.'); result = { bsNumber: row.bs_number, html: row.render_template_snapshot, snapshot: JSON.parse(row.content_snapshot_json) as BillingStatementRenderSnapshot, initialPayment: null }; return; }
    if (row.document_state !== 'draft') throw new Error('Only a draft billing statement can be finalized.'); validateBusinessDate(row.business_date,row.backdate_reason ?? undefined);
    const lines = await listFinalLines(tx,statementId,row.customer_id); if (!lines.length) throw new Error('Add at least one billable item, service, or expense before finalizing.');
    const changed: string[] = []; const changedIds = new Set<string>(); const required = new Map<string,{name:string,quantity:number,stock:number}>();
    for (const line of lines) {
      if (line.line_type === 'item' && !line.source_csr_usage_id && line.item_id) {
        if (line.item_active !== 1) throw new Error(`${line.description_snapshot} is inactive.`);
        const current = line.customer_price_centavos ?? line.base_selling_price_centavos ?? 0;
        if (line.price_source !== 'override' && line.unit_price_centavos !== current) { changed.push(line.description_snapshot); changedIds.add(line.id); }
        const entry = required.get(line.item_id) ?? { name: line.description_snapshot, quantity: 0, stock: line.current_stock ?? 0 }; entry.quantity += line.quantity_integer; required.set(line.item_id,entry);
      }
      if (line.line_type === 'service' && line.service_id) { if (line.service_active !== 1) throw new Error(`${line.description_snapshot} is inactive.`); if (line.price_source !== 'override' && line.unit_price_centavos !== line.base_rate_centavos) { changed.push(line.description_snapshot); changedIds.add(line.id); } }
    }
    for (const entry of required.values()) if (entry.quantity > entry.stock) throw new Error(`${entry.name}: only ${entry.stock} available, ${entry.quantity} required.`);
    if (changed.length && pricePolicy === 'reject') throw new BillingDraftPriceChangedError(changed);
    if (changed.length && pricePolicy !== 'reject') { for (const line of lines.filter((value) => changedIds.has(value.id))) { const current = line.line_type === 'service' ? line.base_rate_centavos ?? 0 : line.customer_price_centavos ?? line.base_selling_price_centavos ?? 0; if (pricePolicy === 'use-current') { line.unit_price_centavos=current; line.amount_centavos=safeMultiply(current,line.quantity_integer); await tx.runAsync(`UPDATE billing_statement_lines SET unit_price_centavos=?,amount_centavos=?,price_source=?,override_reason=NULL WHERE id=?`,current,line.amount_centavos,line.line_type === 'service' ? 'catalog' : line.customer_price_centavos === null ? 'base' : 'customer',line.id); } else { await tx.runAsync("UPDATE billing_statement_lines SET price_source='override',override_reason='Draft price retained after price change' WHERE id=?",line.id); } } }
    const subtotal = lines.reduce((sum,line)=>sum+line.amount_centavos,0); const discountCentavos = calculateDiscountCentavos(subtotal,toDiscount(row.discount_type,row.discount_value)); const total=subtotal-discountCentavos; const bsNumber=await allocateDocumentNumber(tx,'BS');
    const initialPayment = await createInitialPaymentRecord(tx, { statementId, billingStatementNumber: bsNumber, statementTotalCentavos: total, business: { name: row.business_name, address: row.business_address, contactDetails: row.contact_details }, customer: { name: row.customer_name, address: row.customer_address } }, paymentSelection);
    const paid = initialPayment?.snapshot.amountCentavos ?? 0;
    const snapshot: BillingStatementRenderSnapshot = { bsNumber,businessDate:row.business_date,fingerprint:'',business:{name:row.business_name,address:row.business_address,contactDetails:row.contact_details},customer:{name:row.customer_name,address:row.customer_address},serviceReportNumber:row.csr_number,lines:lines.map((line)=>({description:line.description_snapshot,quantity:line.quantity_integer,unitLabel:line.line_type === 'item' ? line.unit_label || 'pc' : line.line_type === 'service' ? 'service' : 'expense',unitPriceCentavos:line.unit_price_centavos,amountCentavos:line.amount_centavos})),subtotalCentavos:subtotal,discountLabel:discountLabel(row.discount_type,row.discount_value),discountCentavos,totalCentavos:total,paymentsReceivedCentavos:paid,balanceDueCentavos:total-paid,vatDisplayMode:row.vat_display_mode,vatRateBasisPoints:row.vat_rate_basis_points };
    snapshot.preparerSignatureHtml = await getPreparerSignatureHtml(tx);
    snapshot.business.logoDataUrl = await getBusinessLogo(tx);
    snapshot.fingerprint=(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,JSON.stringify(snapshot))).slice(0,12).toUpperCase(); const html=buildBillingStatementHtml(snapshot); const now=new Date().toISOString();
    if (required.size) { const transactionId=Crypto.randomUUID(); await tx.runAsync(`INSERT INTO stock_transactions(id,customer_id,billing_statement_id,transaction_type,state,note,created_at) VALUES(?,?,?,'sale','active',?,?)`,transactionId,row.customer_id,statementId,`Finalized ${bsNumber}`,now); for (const [itemId,entry] of required) await tx.runAsync(`INSERT INTO inventory_movements(id,item_id,stock_transaction_id,movement_type,quantity_delta_integer,billing_statement_id,description,created_at) VALUES(?,?,?,'sale',?,?,?,?)`,Crypto.randomUUID(),itemId,transactionId,-entry.quantity,statementId,`${bsNumber}: ${entry.name}`,now); }
    await tx.runAsync(`UPDATE billing_statements SET bs_number=?,document_state='finalized',subtotal_centavos=?,discounted_total_centavos=?,payment_choice=?,vat_snapshot_json=?,content_snapshot_json=?,render_template_snapshot=?,template_version=?,pdf_state='pending',finalized_at=? WHERE id=? AND document_state='draft'`,bsNumber,subtotal,total,paymentSelection.choice,JSON.stringify({mode:row.vat_display_mode,rateBasisPoints:row.vat_rate_basis_points}),JSON.stringify(snapshot),html,BILLING_STATEMENT_TEMPLATE_VERSION,now,statementId);
    await auditAndRevise(tx,'billing_statement.finalized',statementId,{bsNumber,lineCount:lines.length,pricePolicy,paymentChoice:paymentSelection.choice},now); result={bsNumber,html,snapshot,initialPayment};
  });
  if (!result) throw new Error('Billing statement finalization did not produce a result.'); return result;
}

export async function voidBillingStatement(db: SQLiteDatabase, statementId: string, reason: string, dispositions: Array<{ itemId: string; returnedToStock: boolean }>): Promise<void> {
  const cleanReason=reason.trim(); if (!cleanReason) throw new Error('Void reason is required.'); const now=new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row=await tx.getFirstAsync<{ bs_number:string; customer_id:string }>("SELECT bs_number,customer_id FROM billing_statements WHERE id=? AND document_state='finalized'",statementId); if(!row) throw new Error('Only an unpaid finalized billing statement can be voided.');
    const payment=await tx.getFirstAsync<{ count:number }>("SELECT COUNT(*) AS count FROM payments WHERE billing_statement_id=? AND state='active'",statementId); if((payment?.count??0)>0) throw new Error('A billing statement with an active payment cannot be voided.');
    const movements=await tx.getAllAsync<{ item_id:string; quantity_delta_integer:number; description:string }>("SELECT item_id,quantity_delta_integer,description FROM inventory_movements WHERE billing_statement_id=? AND movement_type='sale'",statementId); const dispositionMap=new Map(dispositions.map((entry)=>[entry.itemId,entry.returnedToStock]));
    const uniqueItems=new Set(movements.map((movement)=>movement.item_id)); for(const itemId of uniqueItems) if(!dispositionMap.has(itemId)) throw new Error('Choose a stock disposition for every directly billed item.');
    const original=await tx.getFirstAsync<{ id:string }>("SELECT id FROM stock_transactions WHERE billing_statement_id=? AND transaction_type='sale' AND state='active'",statementId); if(original) await tx.runAsync("UPDATE stock_transactions SET state='voided',voided_at=? WHERE id=?",now,original.id);
    const returned=movements.filter((movement)=>dispositionMap.get(movement.item_id)); if(returned.length){ const reversalId=Crypto.randomUUID(); await tx.runAsync(`INSERT INTO stock_transactions(id,customer_id,billing_statement_id,transaction_type,state,note,created_at) VALUES(?,?,?,'reversal','active',?,?)`,reversalId,row.customer_id,statementId,`Stock returned after voiding ${row.bs_number}`,now); for(const movement of returned) await tx.runAsync(`INSERT INTO inventory_movements(id,item_id,stock_transaction_id,movement_type,quantity_delta_integer,billing_statement_id,description,created_at) VALUES(?,?,?,'reversal',?,?,?,?)`,Crypto.randomUUID(),movement.item_id,reversalId,-movement.quantity_delta_integer,statementId,`Return after voiding ${row.bs_number}: ${movement.description}`,now); }
    await tx.runAsync("UPDATE billing_statements SET document_state='voided',voided_at=?,void_reason=? WHERE id=?",now,cleanReason,statementId); await auditAndRevise(tx,'billing_statement.voided',statementId,{reason:cleanReason,returnedItemCount:returned.length},now);
  });
}

async function listLines(db: SQLiteDatabase, statementId: string): Promise<BillingStatementLine[]> { const rows=await db.getAllAsync<LineRow>('SELECT * FROM billing_statement_lines WHERE billing_statement_id=? ORDER BY created_at,rowid',statementId); return rows.map(mapLine); }
async function listExpenses(db: SQLiteDatabase, statementId: string): Promise<BillingExpense[]> { const rows=await db.getAllAsync<ExpenseRow>('SELECT id,description,actual_cost_centavos,billable,billed_amount_centavos FROM expenses WHERE billing_statement_id=? ORDER BY created_at,rowid',statementId); return rows.map((row)=>({id:row.id,description:row.description,actualCostCentavos:row.actual_cost_centavos,billable:row.billable===1,billedAmountCentavos:row.billed_amount_centavos})); }
async function listFinalLines(db: SQLiteDatabase, statementId: string, customerId: string): Promise<FinalLineRow[]> { return db.getAllAsync<FinalLineRow>(`SELECT l.*,i.unit_label,i.active AS item_active,i.base_selling_price_centavos,p.selling_price_centavos AS customer_price_centavos,COALESCE((SELECT SUM(m.quantity_delta_integer) FROM inventory_movements m WHERE m.item_id=l.item_id),0) AS current_stock,s.active AS service_active,s.base_rate_centavos FROM billing_statement_lines l LEFT JOIN items i ON i.id=l.item_id LEFT JOIN customer_item_prices p ON p.item_id=l.item_id AND p.customer_id=? AND p.effective_to IS NULL LEFT JOIN services s ON s.id=l.service_id WHERE l.billing_statement_id=? ORDER BY l.created_at,l.rowid`,customerId,statementId); }
async function getSubtotal(db: SQLiteDatabase, statementId: string): Promise<number> { const row=await db.getFirstAsync<{ subtotal:number }>('SELECT COALESCE(SUM(amount_centavos),0) AS subtotal FROM billing_statement_lines WHERE billing_statement_id=?',statementId); return row?.subtotal??0; }
async function refreshTotals(db: SQLiteDatabase, statementId: string): Promise<void> { const row=await db.getFirstAsync<{ discount_type:BillingDiscountType; discount_value:number }>("SELECT discount_type,discount_value FROM billing_statements WHERE id=? AND document_state='draft'",statementId); if(!row) throw new Error('Only a draft statement can be changed.'); const subtotal=await getSubtotal(db,statementId); const discount=calculateDiscountCentavos(subtotal,toDiscount(row.discount_type,row.discount_value)); await db.runAsync('UPDATE billing_statements SET subtotal_centavos=?,discounted_total_centavos=? WHERE id=?',subtotal,subtotal-discount,statementId); }
function toDiscount(type: BillingDiscountType,value:number): Discount { return type === 'fixed' ? {type:'fixed',valueCentavos:value} : type === 'percentage' ? {type:'percentage',basisPoints:value} : null; }
function discountLabel(type: BillingDiscountType,value:number): string|null { return type === 'fixed' ? 'Discount' : type === 'percentage' ? `Discount (${(value/100).toFixed(2).replace(/\.00$/,'')}%)` : null; }
function mapSummary(row:SummaryRow):BillingStatementSummary{return{id:row.id,bsNumber:row.bs_number,customerName:row.customer_name,documentState:row.document_state,businessDate:row.business_date,discountedTotalCentavos:row.discounted_total_centavos,pdfState:row.pdf_state};}
function mapLine(row:LineRow):BillingStatementLine{return{id:row.id,lineType:row.line_type,sourceCsrUsageId:row.source_csr_usage_id,itemId:row.item_id,serviceId:row.service_id,expenseId:row.expense_id,description:row.description_snapshot,quantity:row.quantity_integer,unitPriceCentavos:row.unit_price_centavos,amountCentavos:row.amount_centavos,priceSource:row.price_source,overrideReason:row.override_reason};}
function assertMoney(value:number,label:string):void{if(!Number.isSafeInteger(value)||value<0)throw new Error(`${label} must be a non-negative amount.`);}
function safeMultiply(price:number,quantity:number):number{const value=price*quantity;if(!Number.isSafeInteger(value)||value<0)throw new Error('Line amount is too large.');return value;}
async function auditAndRevise(db:SQLiteDatabase,eventType:string,entityId:string,details:Record<string,string|number|boolean|null>,createdAt:string){await appendAuditEvent(db,{eventType,entityType:'billing_statement',entityId,details,createdAt});await incrementDatabaseRevision(db);}
