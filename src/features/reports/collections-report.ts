import type { SQLiteDatabase } from 'expo-sqlite';

export type CollectionStateFilter = 'all' | 'active' | 'voided';
export type CollectionMethodFilter = 'all' | 'cash' | 'bank_transfer' | 'e_wallet' | 'check' | 'other';
export type CollectionsReportFilter = {
  from: string;
  to: string;
  customerId?: string;
  state?: CollectionStateFilter;
  method?: CollectionMethodFilter;
};
export type CollectionsReportRow = {
  id: string;
  paNumber: string | null;
  billingStatementId: string;
  billingStatementNumber: string | null;
  customerId: string;
  customerName: string;
  amountCentavos: number;
  businessDate: string;
  method: Exclude<CollectionMethodFilter, 'all'>;
  referenceNumber: string | null;
  paymentKind: string | null;
  state: Exclude<CollectionStateFilter, 'all'>;
  voidReason: string | null;
};

type CollectionsReportSqlRow = {
  id: string;
  pa_number: string | null;
  billing_statement_id: string;
  bs_number: string | null;
  customer_id: string;
  customer_name: string;
  amount_centavos: number;
  business_date: string;
  method: CollectionsReportRow['method'];
  reference_number: string | null;
  payment_kind: string | null;
  state: CollectionsReportRow['state'];
  void_reason: string | null;
};

export const COLLECTION_STATE_FILTERS: CollectionStateFilter[] = ['all', 'active', 'voided'];
export const COLLECTION_METHOD_FILTERS: CollectionMethodFilter[] = ['all', 'cash', 'bank_transfer', 'e_wallet', 'check', 'other'];

export function validateCollectionsReportFilter(filter: CollectionsReportFilter): void {
  for (const date of [filter.from, filter.to]) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error('Enter valid dates using YYYY-MM-DD.');
    }
  }
  if (filter.from > filter.to) throw new Error('Start date must be on or before end date.');
  if (!COLLECTION_STATE_FILTERS.includes(filter.state ?? 'all')) throw new Error('Choose a valid payment state.');
  if (!COLLECTION_METHOD_FILTERS.includes(filter.method ?? 'all')) throw new Error('Choose a valid payment method.');
}

export async function getCollectionsReport(db: SQLiteDatabase, filter: CollectionsReportFilter): Promise<CollectionsReportRow[]> {
  validateCollectionsReportFilter(filter);
  const state = filter.state ?? 'active';
  const method = filter.method ?? 'all';
  const rows = await db.getAllAsync<CollectionsReportSqlRow>(
    `SELECT
       p.id,
       p.pa_number,
       p.billing_statement_id,
       b.bs_number,
       c.id AS customer_id,
       c.name AS customer_name,
       p.amount_centavos,
       p.business_date,
       p.method,
       p.reference_number,
       p.payment_kind,
       p.state,
       p.void_reason
     FROM payments p
     JOIN billing_statements b ON b.id=p.billing_statement_id
     JOIN customers c ON c.id=b.customer_id
     WHERE p.business_date BETWEEN ? AND ?
       AND (? IS NULL OR c.id=?)
       AND (?='all' OR p.state=?)
       AND (?='all' OR p.method=?)
     ORDER BY p.business_date DESC, p.created_at DESC, p.rowid DESC`,
    filter.from,
    filter.to,
    filter.customerId || null,
    filter.customerId || null,
    state,
    state,
    method,
    method,
  );
  return rows.map(row => ({
    id: row.id,
    paNumber: row.pa_number,
    billingStatementId: row.billing_statement_id,
    billingStatementNumber: row.bs_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    amountCentavos: row.amount_centavos,
    businessDate: row.business_date,
    method: row.method,
    referenceNumber: row.reference_number,
    paymentKind: row.payment_kind,
    state: row.state,
    voidReason: row.void_reason,
  }));
}

export function filterCollectionsReport(rows: CollectionsReportRow[], query: string): CollectionsReportRow[] {
  const text = query.trim().toLowerCase();
  if (!text) return rows;
  return rows.filter(row => [
    row.paNumber ?? '',
    row.billingStatementNumber ?? '',
    row.customerName,
    row.method,
    row.referenceNumber ?? '',
    row.paymentKind ?? '',
    row.state,
    row.voidReason ?? '',
  ].some(value => value.toLowerCase().includes(text)));
}

export function sumActiveCollections(rows: CollectionsReportRow[]): number {
  return rows.reduce((sum, row) => sum + (row.state === 'active' ? row.amountCentavos : 0), 0);
}

export function collectionsReportCsv(rows: CollectionsReportRow[]): string {
  return csv([
    ['Payment date','PA number','Billing Statement','Customer','State','Method','Reference','Kind','Amount PHP','Void reason'],
    ...rows.map(row => [
      row.businessDate,
      row.paNumber ?? '',
      row.billingStatementNumber ?? '',
      row.customerName,
      row.state,
      methodLabel(row.method),
      row.referenceNumber ?? '',
      row.paymentKind ?? '',
      (row.amountCentavos / 100).toFixed(2),
      row.voidReason ?? '',
    ]),
  ]);
}

export function methodLabel(method: CollectionMethodFilter): string {
  if (method === 'all') return 'All';
  if (method === 'bank_transfer') return 'Bank transfer';
  if (method === 'e_wallet') return 'GCash/e-wallet';
  return method.charAt(0).toUpperCase() + method.slice(1);
}

function csv(rows: Array<Array<string | number>>): string {
  return '\uFEFF' + rows.map(row => row.map(value => {
    let cell = String(value);
    if (typeof value === 'string' && /^[=+@\-\t\r\n]/.test(cell)) cell = "'" + cell;
    return '"' + cell.replaceAll('"', '""') + '"';
  }).join(',')).join('\r\n');
}
