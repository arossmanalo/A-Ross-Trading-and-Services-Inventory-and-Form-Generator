import type { SQLiteDatabase } from 'expo-sqlite';

export type ReportFilter = { from: string; to: string; customerId?: string };
export type FinancialReport = {
  statementCount: number; grossSales: number; discounts: number; netCharges: number;
  collections: number; outstanding: number; expenses: number; netAfterExpenses: number;
};

export function validateReportFilter(filter: ReportFilter): void {
  for (const date of [filter.from,filter.to]) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date) throw new Error('Enter valid dates using YYYY-MM-DD.');
  }
  if (filter.from > filter.to) throw new Error('Start date must be on or before end date.');
}

export async function getFinancialReport(db: SQLiteDatabase, filter: ReportFilter): Promise<FinancialReport> {
  validateReportFilter(filter);
  // Independent aggregates prevent multiple payments and expenses multiplying sales.
  // One SELECT gives all totals the same SQLite read snapshot.
  const report = await db.getFirstAsync<FinancialReport>(`
    WITH selected AS (
      SELECT * FROM billing_statements
      WHERE document_state='finalized' AND business_date BETWEEN ? AND ?
        AND (? IS NULL OR customer_id=?)
    ), sales AS (
      SELECT COUNT(*) AS statementCount, COALESCE(SUM(subtotal_centavos),0) AS grossSales,
        COALESCE(SUM(subtotal_centavos-discounted_total_centavos),0) AS discounts,
        COALESCE(SUM(discounted_total_centavos),0) AS netCharges FROM selected
    ), costs AS (
      SELECT COALESCE(SUM(e.actual_cost_centavos),0) AS expenses
      FROM expenses e JOIN selected b ON b.id=e.billing_statement_id
    ), received AS (
      SELECT COALESCE(SUM(p.amount_centavos),0) AS collections FROM payments p
      JOIN billing_statements b ON b.id=p.billing_statement_id
      WHERE p.state='active' AND b.document_state='finalized'
        AND p.business_date BETWEEN ? AND ? AND (? IS NULL OR b.customer_id=?)
    ), balances AS (
      SELECT COALESCE(SUM(b.discounted_total_centavos-COALESCE((
        SELECT SUM(p.amount_centavos) FROM payments p
        WHERE p.billing_statement_id=b.id AND p.state='active'
      ),0)),0) AS outstanding FROM selected b
    ) SELECT sales.*,costs.expenses,received.collections,balances.outstanding,
      sales.netCharges-costs.expenses AS netAfterExpenses
      FROM sales CROSS JOIN costs CROSS JOIN received CROSS JOIN balances`,
    filter.from,filter.to,filter.customerId || null,filter.customerId || null,
    filter.from,filter.to,filter.customerId || null,filter.customerId || null);
  if (!report) throw new Error('Could not calculate the report.');
  if (Object.values(report).some(value => !Number.isSafeInteger(value))) throw new Error('Report totals exceed the supported numeric range. Narrow the report dates.');
  return report;
}

export const FINANCIAL_METRICS: Array<{key: keyof FinancialReport; label: string}> = [
  {key:'grossSales',label:'Gross Sales'}, {key:'discounts',label:'Discounts'},
  {key:'netCharges',label:'Net Customer Charges'}, {key:'collections',label:'Cash Collected'},
  {key:'outstanding',label:'Current Outstanding on Selected Statements'},
  {key:'expenses',label:'Recorded Expenses'}, {key:'netAfterExpenses',label:'Net Revenue After Recorded Expenses'},
];

export function financialReportCsv(report: FinancialReport, filter: ReportFilter, customerName: string): string {
  const rows: Array<Array<string|number>> = [
    ['Report','Financial summary'], ['From',filter.from], ['To',filter.to], ['Customer',customerName],
    ['Sales / expenses basis','Statement business dates; includes linked billable and non-billable actual costs'],
    ['Collections basis','Payment business dates, including payments for statements outside this period'],
    ['Outstanding basis','Current balance of statements issued in the selected period; includes all active payments'],
    ['Finalized statements',report.statementCount], ['Metric','PHP'],
    ...FINANCIAL_METRICS.map(({key,label}) => [label,(report[key]/100).toFixed(2)]),
  ];
  return '\uFEFF'+rows.map(row => row.map(value => {
    let cell=String(value);
    // Neutralize spreadsheet formulas in user-entered names while retaining numbers.
    if (typeof value === 'string' && /^[=+@\-\t\r\n]/.test(cell) && !/^-?\d+(\.\d+)?$/.test(cell)) cell="'"+cell;
    return '"'+cell.replaceAll('"','""')+'"';
  }).join(',')).join('\r\n');
}
