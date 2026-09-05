import type { InventoryItemSummary } from '@/features/inventory/inventory-types';

export type StockFilter = 'all' | 'active' | 'inactive' | 'low';
export function filterStockReport(items: InventoryItemSummary[], query: string, status: StockFilter): InventoryItemSummary[] {
  const text=query.trim().toLowerCase();
  return items.filter(item => (!text || [item.name,item.sku??'',item.unitLabel].some(value=>value.toLowerCase().includes(text))) &&
    (status==='all' || (status==='inactive' ? !item.active : item.active && (status!=='low' || item.currentStock<=item.lowStockThreshold))));
}

export function stockReportCsv(items: InventoryItemSummary[]): string {
  const rows: Array<Array<string|number>> = [['Item','SKU','Unit','Current stock','Low-stock threshold','Status','Low stock','Base selling price PHP'],
    ...items.map(item=>[item.name,item.sku??'',item.unitLabel,item.currentStock,item.lowStockThreshold,item.active?'Active':'Inactive',item.active&&item.currentStock<=item.lowStockThreshold?'Yes':'No',(item.baseSellingPriceCentavos/100).toFixed(2)])];
  return '\uFEFF'+rows.map(row=>row.map(value=>{
    let cell=String(value);
    if(typeof value==='string'&&/^[=+@\-\t\r\n]/.test(cell))cell="'"+cell;
    return '"'+cell.replaceAll('"','""')+'"';
  }).join(',')).join('\r\n');
}
