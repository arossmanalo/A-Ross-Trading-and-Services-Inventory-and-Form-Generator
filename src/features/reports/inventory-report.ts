import type { InventoryItemSummary } from '@/features/inventory/inventory-types';
import type { SQLiteDatabase } from 'expo-sqlite';

export type StockFilter = 'all' | 'active' | 'inactive' | 'low';
export type MovementTypeFilter = 'all' | 'restock' | 'sale' | 'nonbillable_usage' | 'consumption' | 'reversal';
export type MovementReportFilter = { from: string; to: string; itemId?: string; movementType?: MovementTypeFilter };
export type InventoryMovementReportRow = {
  id: string;
  itemId: string;
  itemName: string;
  sku: string | null;
  unitLabel: string;
  movementType: Exclude<MovementTypeFilter, 'all'>;
  quantityDelta: number;
  description: string;
  serviceReportId: string | null;
  serviceReportNumber: string | null;
  billingStatementId: string | null;
  billingStatementNumber: string | null;
  createdAt: string;
};

type MovementReportSqlRow = {
  id: string;
  item_id: string;
  item_name: string;
  sku: string | null;
  unit_label: string;
  movement_type: InventoryMovementReportRow['movementType'];
  quantity_delta_integer: number;
  description: string;
  service_report_id: string | null;
  service_report_number: string | null;
  billing_statement_id: string | null;
  billing_statement_number: string | null;
  created_at: string;
};

export function filterStockReport(items: InventoryItemSummary[], query: string, status: StockFilter): InventoryItemSummary[] {
  const text=query.trim().toLowerCase();
  return items.filter(item => (!text || [item.name,item.sku??'',item.unitLabel].some(value=>value.toLowerCase().includes(text))) &&
    (status==='all' || (status==='inactive' ? !item.active : item.active && (status!=='low' || item.currentStock<=item.lowStockThreshold))));
}

export function validateMovementReportFilter(filter: MovementReportFilter): void {
  for (const date of [filter.from, filter.to]) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error('Enter valid dates using YYYY-MM-DD.');
    }
  }
  if (filter.from > filter.to) throw new Error('Start date must be on or before end date.');
  const type = filter.movementType ?? 'all';
  if (!['all','restock','sale','nonbillable_usage','consumption','reversal'].includes(type)) throw new Error('Choose a valid movement type.');
}

export async function getInventoryMovementReport(db: SQLiteDatabase, filter: MovementReportFilter): Promise<InventoryMovementReportRow[]> {
  validateMovementReportFilter(filter);
  const rows = await db.getAllAsync<MovementReportSqlRow>(
    `SELECT
       m.id,
       m.item_id,
       i.name AS item_name,
       i.sku,
       i.unit_label,
       m.movement_type,
       m.quantity_delta_integer,
       m.description,
       m.service_report_id,
       r.csr_number AS service_report_number,
       m.billing_statement_id,
       b.bs_number AS billing_statement_number,
       m.created_at
     FROM inventory_movements m
     JOIN items i ON i.id = m.item_id
     LEFT JOIN service_reports r ON r.id = m.service_report_id
     LEFT JOIN billing_statements b ON b.id = m.billing_statement_id
     WHERE substr(m.created_at, 1, 10) BETWEEN ? AND ?
       AND (? IS NULL OR m.item_id = ?)
       AND (? = 'all' OR m.movement_type = ?)
     ORDER BY m.created_at DESC, m.rowid DESC`,
    filter.from,
    filter.to,
    filter.itemId || null,
    filter.itemId || null,
    filter.movementType ?? 'all',
    filter.movementType ?? 'all',
  );
  return rows.map(row => ({
    id: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    sku: row.sku,
    unitLabel: row.unit_label,
    movementType: row.movement_type,
    quantityDelta: row.quantity_delta_integer,
    description: row.description,
    serviceReportId: row.service_report_id,
    serviceReportNumber: row.service_report_number,
    billingStatementId: row.billing_statement_id,
    billingStatementNumber: row.billing_statement_number,
    createdAt: row.created_at,
  }));
}

export function stockReportCsv(items: InventoryItemSummary[]): string {
  const rows: Array<Array<string|number>> = [['Item','SKU','Unit','Current stock','Low-stock threshold','Status','Low stock','Base selling price PHP'],
    ...items.map(item=>[item.name,item.sku??'',item.unitLabel,item.currentStock,item.lowStockThreshold,item.active?'Active':'Inactive',item.active&&item.currentStock<=item.lowStockThreshold?'Yes':'No',(item.baseSellingPriceCentavos/100).toFixed(2)])];
  return csv(rows);
}

export function filterMovementReport(rows: InventoryMovementReportRow[], query: string): InventoryMovementReportRow[] {
  const text = query.trim().toLowerCase();
  if (!text) return rows;
  return rows.filter(row => [
    row.itemName,
    row.sku ?? '',
    row.unitLabel,
    row.movementType,
    row.description,
    row.serviceReportNumber ?? '',
    row.billingStatementNumber ?? '',
  ].some(value => value.toLowerCase().includes(text)));
}

export function movementReportCsv(rows: InventoryMovementReportRow[]): string {
  return csv([
    ['Date/time','Item','SKU','Movement type','Quantity change','Unit','Description','CSR','Billing Statement'],
    ...rows.map(row => [
      row.createdAt,
      row.itemName,
      row.sku ?? '',
      movementTypeLabel(row.movementType),
      row.quantityDelta,
      row.unitLabel,
      row.description,
      row.serviceReportNumber ?? '',
      row.billingStatementNumber ?? '',
    ]),
  ]);
}

export function movementTypeLabel(type: InventoryMovementReportRow['movementType']): string {
  return type === 'nonbillable_usage' ? 'Non-billable use' : type.charAt(0).toUpperCase() + type.slice(1);
}

function csv(rows: Array<Array<string|number>>): string {
  return '\uFEFF'+rows.map(row=>row.map(value=>{
    let cell=String(value);
    if(typeof value==='string'&&/^[=+@\-\t\r\n]/.test(cell))cell="'"+cell;
    return '"'+cell.replaceAll('"','""')+'"';
  }).join(',')).join('\r\n');
}
