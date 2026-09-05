import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import { allocateDocumentNumber } from '@/db/sequences';
import { validateBusinessDate } from '@/domain/business-date';
import { buildPaymentAcknowledgmentHtml, PAYMENT_ACKNOWLEDGMENT_TEMPLATE_VERSION, type PaymentRenderSnapshot } from '@/features/payments/payment-template';
import type { InitialPaymentSelection, PaymentEntryInput, PaymentKind, PaymentMethod, PaymentState, PaymentSummary, StatementPaymentStatus } from '@/features/payments/payment-types';

type PaymentRow = {
  id: string; pa_number: string; billing_statement_id: string; bs_number: string;
  customer_name: string; amount_centavos: number; business_date: string;
  method: PaymentMethod; reference_number: string | null; note: string | null;
  payment_kind: PaymentKind; state: PaymentState; void_reason: string | null;
  pdf_state: PaymentSummary['pdfState']; share_state: PaymentSummary['shareState'];
};

export type PaymentRenderResult = { paymentId: string; paNumber: string; html: string; snapshot: PaymentRenderSnapshot };
export type InitialPaymentContext = {
  statementId: string; billingStatementNumber: string; statementTotalCentavos: number;
  business: PaymentRenderSnapshot['business']; customer: PaymentRenderSnapshot['customer'];
};

export async function listPayments(db: SQLiteDatabase): Promise<PaymentSummary[]> {
  const rows = await db.getAllAsync<PaymentRow>(paymentSelect('ORDER BY p.created_at DESC'));
  return rows.map(mapPayment);
}

export async function listPaymentsForStatement(db: SQLiteDatabase, statementId: string): Promise<StatementPaymentStatus> {
  const statement = await db.getFirstAsync<{ discounted_total_centavos: number }>('SELECT discounted_total_centavos FROM billing_statements WHERE id=?', statementId);
  if (!statement) throw new Error('Billing statement was not found.');
  const rows = await db.getAllAsync<PaymentRow>(paymentSelect('WHERE p.billing_statement_id=? ORDER BY p.created_at,p.rowid'), statementId);
  const payments = rows.map(mapPayment);
  const activePaidCentavos = payments.filter((payment) => payment.state === 'active').reduce((sum, payment) => sum + payment.amountCentavos, 0);
  const balanceCentavos = statement.discounted_total_centavos - activePaidCentavos;
  if (balanceCentavos < 0) throw new Error('Payment data exceeds the statement total.');
  return {
    totalCentavos: statement.discounted_total_centavos,
    activePaidCentavos,
    balanceCentavos,
    status: balanceCentavos === 0 ? 'paid' : activePaidCentavos === 0 ? 'unpaid' : 'balance_due',
    payments,
  };
}

export async function getPayment(db: SQLiteDatabase, paymentId: string): Promise<PaymentSummary | null> {
  const row = await db.getFirstAsync<PaymentRow>(paymentSelect('WHERE p.id=?'), paymentId);
  return row ? mapPayment(row) : null;
}

export async function createInitialPaymentRecord(
  db: SQLiteDatabase,
  context: InitialPaymentContext,
  selection: InitialPaymentSelection,
): Promise<PaymentRenderResult | null> {
  if (context.statementTotalCentavos === 0) {
    if (selection.choice !== 'pay_later') throw new Error('A zero-total statement does not require a payment.');
    return null;
  }
  if (selection.choice === 'pay_later') return null;
  if (!selection.payment) throw new Error('Payment details are required for this payment choice.');
  const amount = selection.payment.amountCentavos;
  if (selection.choice === 'paid_in_full' && amount !== context.statementTotalCentavos) throw new Error('Paid in Full must equal the statement total.');
  if (selection.choice === 'down_payment' && (amount <= 0 || amount >= context.statementTotalCentavos)) throw new Error('Down Payment must be above zero and below the statement total.');
  return insertPayment(db, context, selection.choice, { ...selection.payment, idempotencyKey: `statement:${context.statementId}:initial-payment` }, 0);
}

export async function createLaterPayment(db: SQLiteDatabase, statementId: string, input: PaymentEntryInput): Promise<PaymentRenderResult> {
  let result: PaymentRenderResult | null = null;
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.getFirstAsync<{ id: string; pa_number: string; render_template_snapshot: string; content_snapshot_json: string }>("SELECT id,pa_number,render_template_snapshot,content_snapshot_json FROM payments WHERE idempotency_key=? AND billing_statement_id=?", input.idempotencyKey, statementId);
      if (existing) {
        result = { paymentId: existing.id, paNumber: existing.pa_number, html: existing.render_template_snapshot, snapshot: JSON.parse(existing.content_snapshot_json) as PaymentRenderSnapshot };
        return;
      }
    }
    const statement = await tx.getFirstAsync<{
      bs_number: string; discounted_total_centavos: number; payment_choice: InitialPaymentSelection['choice'];
      customer_name: string; customer_address: string; business_name: string; business_address: string; contact_details: string;
    }>(`SELECT b.bs_number,b.discounted_total_centavos,b.payment_choice,c.name AS customer_name,c.address AS customer_address,s.business_name,s.business_address,s.contact_details FROM billing_statements b JOIN customers c ON c.id=b.customer_id JOIN settings s ON s.id='business' WHERE b.id=? AND b.document_state='finalized'`, statementId);
    if (!statement || !statement.payment_choice) throw new Error('Only a finalized statement can accept payment.');
    const totals = await tx.getFirstAsync<{ amount: number }>("SELECT COALESCE(SUM(amount_centavos),0) AS amount FROM payments WHERE billing_statement_id=? AND state='active'", statementId);
    const activePaid = totals?.amount ?? 0;
    const balance = statement.discounted_total_centavos - activePaid;
    if (balance <= 0) throw new Error('This statement has no remaining balance.');
    let kind: PaymentKind;
    if (statement.payment_choice === 'down_payment' && activePaid === 0) {
      if (input.amountCentavos <= 0 || input.amountCentavos >= statement.discounted_total_centavos) throw new Error('The replacement down payment must be above zero and below the statement total.');
      kind = 'down_payment';
    } else {
      if (input.amountCentavos !== balance) throw new Error(`The next payment must equal the full remaining balance of ${formatAmount(balance)}.`);
      kind = statement.payment_choice === 'down_payment' ? 'balance_payment' : statement.payment_choice === 'paid_in_full' ? 'paid_in_full' : 'later_full';
    }
    result = await insertPayment(tx, {
      statementId, billingStatementNumber: statement.bs_number,
      statementTotalCentavos: statement.discounted_total_centavos,
      business: { name: statement.business_name, address: statement.business_address, contactDetails: statement.contact_details },
      customer: { name: statement.customer_name, address: statement.customer_address },
    }, kind, input, activePaid);
    await incrementDatabaseRevision(tx);
  });
  if (!result) throw new Error('Payment finalization did not produce a result.');
  return result;
}

export async function voidPayment(db: SQLiteDatabase, paymentId: string, reason: string): Promise<void> {
  const cleanReason = reason.trim();
  if (!cleanReason) throw new Error('Void reason is required.');
  const now = new Date().toISOString();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const payment = await tx.getFirstAsync<{ billing_statement_id: string; payment_kind: PaymentKind; pa_number: string }>("SELECT billing_statement_id,payment_kind,pa_number FROM payments WHERE id=? AND state='active'", paymentId);
    if (!payment) throw new Error('Only an active payment can be voided.');
    if (payment.payment_kind === 'down_payment') {
      const later = await tx.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM payments WHERE billing_statement_id=? AND payment_kind='balance_payment' AND state='active'", payment.billing_statement_id);
      if ((later?.count ?? 0) > 0) throw new Error('Void the active remaining-balance payment before voiding its down payment.');
    }
    await tx.runAsync("UPDATE payments SET state='voided',void_reason=?,voided_at=? WHERE id=? AND state='active'", cleanReason, now, paymentId);
    await appendAuditEvent(tx, { eventType: 'payment.voided', entityType: 'payment', entityId: paymentId, details: { paNumber: payment.pa_number, reason: cleanReason }, createdAt: now });
    await incrementDatabaseRevision(tx);
  });
}

async function insertPayment(db: SQLiteDatabase, context: InitialPaymentContext, kind: PaymentKind, input: PaymentEntryInput, activePaidBefore: number): Promise<PaymentRenderResult> {
  validatePaymentInput(input);
  const paNumber = await allocateDocumentNumber(db, 'PA');
  const paymentId = Crypto.randomUUID();
  const totalAfter = activePaidBefore + input.amountCentavos;
  if (totalAfter > context.statementTotalCentavos) throw new Error('Payment cannot exceed the remaining balance.');
  const snapshot: PaymentRenderSnapshot = {
    paNumber, businessDate: input.businessDate, fingerprint: '', business: context.business,
    customer: context.customer, billingStatementNumber: context.billingStatementNumber,
    paymentKind: kind, amountCentavos: input.amountCentavos, method: input.method,
    referenceNumber: input.referenceNumber?.trim() ?? '', note: input.note?.trim() ?? '',
    statementTotalCentavos: context.statementTotalCentavos,
    totalPaymentsAfterCentavos: totalAfter, remainingBalanceCentavos: context.statementTotalCentavos - totalAfter,
  };
  snapshot.fingerprint = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(snapshot))).slice(0,12).toUpperCase();
  const html = buildPaymentAcknowledgmentHtml(snapshot);
  const now = new Date().toISOString();
  await db.runAsync(`INSERT INTO payments(id,pa_number,billing_statement_id,amount_centavos,business_date,backdate_reason,method,reference_number,note,state,payment_kind,content_snapshot_json,render_template_snapshot,template_version,pdf_state,share_state,idempotency_key,created_at,finalized_at) VALUES(?,?,?,?,?,?,?,?,?,'active',?,?,?,?, 'pending','not_shared',?,?,?)`, paymentId, paNumber, context.statementId, input.amountCentavos, input.businessDate, input.backdateReason?.trim() || null, input.method, input.referenceNumber?.trim() || null, input.note?.trim() || null, kind, JSON.stringify(snapshot), html, PAYMENT_ACKNOWLEDGMENT_TEMPLATE_VERSION, input.idempotencyKey?.trim() || null, now, now);
  await appendAuditEvent(db, { eventType: 'payment.finalized', entityType: 'payment', entityId: paymentId, details: { paNumber, billingStatementId: context.statementId, amountCentavos: input.amountCentavos, paymentKind: kind }, createdAt: now });
  return { paymentId, paNumber, html, snapshot };
}

function validatePaymentInput(input: PaymentEntryInput): void {
  if (!Number.isSafeInteger(input.amountCentavos) || input.amountCentavos <= 0) throw new Error('Payment amount must be above zero.');
  validateBusinessDate(input.businessDate, input.backdateReason);
  if (!['cash','bank_transfer','e_wallet','check','other'].includes(input.method)) throw new Error('Select a valid payment method.');
  if (input.method !== 'cash' && !input.referenceNumber?.trim()) throw new Error('A reference number is required for non-cash payments.');
}

function paymentSelect(suffix: string): string { return `SELECT p.id,p.pa_number,p.billing_statement_id,b.bs_number,c.name AS customer_name,p.amount_centavos,p.business_date,p.method,p.reference_number,p.note,p.payment_kind,p.state,p.void_reason,p.pdf_state,p.share_state FROM payments p JOIN billing_statements b ON b.id=p.billing_statement_id JOIN customers c ON c.id=b.customer_id ${suffix}`; }
function mapPayment(row: PaymentRow): PaymentSummary { return { id: row.id, paNumber: row.pa_number, billingStatementId: row.billing_statement_id, billingStatementNumber: row.bs_number, customerName: row.customer_name, amountCentavos: row.amount_centavos, businessDate: row.business_date, method: row.method, referenceNumber: row.reference_number, note: row.note, paymentKind: row.payment_kind, state: row.state, voidReason: row.void_reason, pdfState: row.pdf_state, shareState: row.share_state }; }
function formatAmount(value: number): string { return new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(value/100); }
