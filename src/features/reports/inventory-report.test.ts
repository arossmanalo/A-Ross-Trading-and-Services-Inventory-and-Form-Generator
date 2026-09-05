import { describe, expect, it } from 'vitest';
import { filterStockReport, stockReportCsv } from '@/features/reports/inventory-report';
import type { InventoryItemSummary } from '@/features/inventory/inventory-types';

const item:InventoryItemSummary={id:'a',name:'Bearing',sku:'BR-1',unitLabel:'pc',baseSellingPriceCentavos:15025,lowStockThreshold:2,currentStock:2,active:true};
describe('stock reporting',()=>{
  it('excludes inactive items from low stock and supports case-insensitive SKU search',()=>{
    const inactive={...item,id:'b',active:false};
    expect(filterStockReport([item,inactive],'br-1','low')).toEqual([item]);
    expect(filterStockReport([item,inactive],'','inactive')).toEqual([inactive]);
    expect(filterStockReport([item],'missing','all')).toEqual([]);
  });
  it('exports integer quantities, PHP prices, and protected spreadsheet cells',()=>{
    const csv=stockReportCsv([{...item,name:'=malicious',active:false}]);
    expect(csv).toContain('"\'=malicious"');
    expect(csv).toContain('"2","2","Inactive","No","150.25"');
  });
});
