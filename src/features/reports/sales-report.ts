import type { SQLiteDatabase } from 'expo-sqlite';

export type SalesLineTypeFilter = 'all' | 'item' | 'service' | 'expense';
export type SalesReportFilter = { from: string; to: string; customerId?: string; lineType?: SalesLineTypeFilter };
export type SalesReportRow = {
  id: string;
  billingStatementId: string;
  billingStatementNumber: string | null;
  customerId: string;
  customerName: string;
  businessDate: string;
  lineType: Exclude<SalesLineTypeFilter, 'all'>;
  description: string;
  quantity: number;
  unitPriceCentavos: number;
  amountCentavos: number;
  priceSource: string | null;
  overrideReason: string | null;
  serviceReportNumber: string | null;
  statementSubtotalCentavos: number;
  statementDiscountCentavos: number;
  statementTotalCentavos: number;
};

type SalesReportSqlRow = {
  id: string;
  billing_statement_id: string;
  bs_number: string | null;
  customer_id: string;
  customer_name: string;
  business_date: string;
  line_type: SalesReportRow['lineType'];
  description_snapshot: string;
  quantity_integer: number;
  unit_price_centavos: number;
  amount_centavos: number;
  price_source: string | null;
  override_reason: string | null;
  csr_number: string | null;
  subtotal_centavos: number;
  discounted_total_centavos: number;
};

export const SALES_LINE_TYPE_FILTERS: SalesLineTypeFilter[] = ['all', 'item', 'service', 'expense'];

export function validateSalesReportFilter(filter: SalesReportFilter): void {
  for (const date of [filter.from, filter.to]) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error('Enter valid dates using YYYY-MM-DD.');
    }
  }
  if (filter.from > filter.to) throw new Error('Start date must be on or before end date.');
  if (!SALES_LINE_TYPE_FILTERS.includes(filter.lineType ?? 'all')) throw new Error('Choose a valid sales line type.');
}

export async function getSalesReport(db: SQLiteDatabase, filter: SalesReportFilter): Promise<SalesReportRow[]> {
  validateSalesReportFilter(filter);
  const lineType = filter.lineType ?? 'all';
  const rows = await db.getAllAsync<SalesReportSqlRow>(
    `SELECT
       l.id,
       l.billing_statement_id,
       b.bs_number,
       c.id AS customer_id,
       c.name AS customer_name,
       b.business_date,
       l.line_type,
       l.description_snapshot,
       l.quantity_integer,
       l.unit_price_centavos,
       l.amount_centavos,
       l.price_source,
       l.override_reason,
       r.csr_number,
       b.subtotal_centavos,
       b.discounted_total_centavos
     FROM billing_statement_lines l
     JOIN billing_statements b ON b.id=l.billing_statement_id
     JOIN customers c ON c.id=b.customer_id
     LEFT JOIN service_report_item_usage u ON u.id=l.source_csr_usage_id
     LEFT JOIN service_reports r ON r.id=COALESCE(u.service_report_id,b.service_report_id)
     WHERE b.document_state='finalized'
       AND b.business_date BETWEEN ? AND ?
       AND (? IS NULL OR c.id=?)
       AND (?='all' OR l.line_type=?)
     ORDER BY b.business_date DESC, b.finalized_at DESC, b.rowid DESC, l.created_at ASC, l.rowid ASC`,
    filter.from,
    filter.to,
    filter.customerId || null,
    filter.customerId || null,
    lineType,
    lineType,
  );
  return rows.map(row => ({
    id: row.id,
    billingStatementId: row.billing_statement_id,
    billingStatementNumber: row.bs_number,
    customerId: row.customer_id,
    customerName: row.customer_name,
    businessDate: row.business_date,
    lineType: row.line_type,
    description: row.description_snapshot,
    quantity: row.quantity_integer,
    unitPriceCentavos: row.unit_price_centavos,
    amountCentavos: row.amount_centavos,
    priceSource: row.price_source,
    overrideReason: row.override_reason,
    serviceReportNumber: row.csr_number,
    statementSubtotalCentavos: row.subtotal_centavos,
    statementDiscountCentavos: row.subtotal_centavos - row.discounted_total_centavos,
    statementTotalCentavos: row.discounted_total_centavos,
  }));
}

export function filterSalesReport(rows: SalesReportRow[], query: string): SalesReportRow[] {
  const text = query.trim().toLowerCase();
  if (!text) return rows;
  return rows.filter(row => [
    row.billingStatementNumber ?? '',
    row.customerName,
    row.description,
    row.lineType,
    row.priceSource ?? '',
    row.overrideReason ?? '',
    row.serviceReportNumber ?? '',
  ].some(value => value.toLowerCase().includes(text)));
}

export function salesReportCsv(rows: SalesReportRow[]): string {
  return csv([
    ['Statement date','Billing Statement','Customer','Line type','Description','Quantity','Unit price PHP','Line amount PHP','CSR','Price source','Override reason','Statement discount PHP','Statement total PHP'],
    ...rows.map(row => [
      row.businessDate,
      row.billingStatementNumber ?? '',
      row.customerName,
      lineTypeLabel(row.lineType),
      row.description,
      row.quantity,
      (row.unitPriceCentavos / 100).toFixed(2),
      (row.amountCentavos / 100).toFixed(2),
      row.serviceReportNumber ?? '',
      row.priceSource ?? '',
      row.overrideReason ?? '',
      (row.statementDiscountCentavos / 100).toFixed(2),
      (row.statementTotalCentavos / 100).toFixed(2),
    ]),
  ]);
}

export function lineTypeLabel(type: SalesLineTypeFilter): string {
  if (type === 'all') return 'All';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function csv(rows: Array<Array<string | number>>): string {
  return '\uFEFF' + rows.map(row => row.map(value => {
    let cell = String(value);
    if (typeof value === 'string' && /^[=+@\-\t\r\n]/.test(cell) && !/^-?\d+(\.\d+)?$/.test(cell)) cell = "'" + cell;
    return '"' + cell.replaceAll('"', '""') + '"';
  }).join(',')).join('\r\n');
}
