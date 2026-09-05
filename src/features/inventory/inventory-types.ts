export type InventoryItemSummary = {
  id: string;
  name: string;
  sku: string | null;
  unitLabel: string;
  baseSellingPriceCentavos: number;
  lowStockThreshold: number;
  currentStock: number;
  active: boolean;
};

export type InventoryItemDetail = InventoryItemSummary & {
  description: string;
};

export type InventoryMovementSummary = {
  id: string;
  movementType: 'consumption' | 'nonbillable_usage' | 'restock' | 'reversal' | 'sale';
  quantityDelta: number;
  description: string;
  serviceReportId: string | null;
  billingStatementId: string | null;
  createdAt: string;
};

export type CreateInventoryItemInput = {
  name: string;
  sku?: string;
  description?: string;
  unitLabel: string;
  baseSellingPriceCentavos: number;
  lowStockThreshold: number;
  openingStock: number;
  openingStockDescription: string;
  allowDuplicateSku?: boolean;
};

export type InventoryMovementInput = {
  itemId: string;
  quantity: number;
  description: string;
  serviceReportId?: string;
};
