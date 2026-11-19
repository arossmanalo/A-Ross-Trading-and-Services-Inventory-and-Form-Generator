/** Parts (stored as 'supply') are used up on repairs (CSRs); products are sold on deliveries, quotations and statements. */
export type InventoryKind = 'supply' | 'product';

export type InventoryItemSummary = {
  id: string;
  inventoryKind: InventoryKind;
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
  inventoryKind: InventoryKind;
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

export type UpdateInventoryItemInput = {
  inventoryKind: InventoryKind;
  name: string;
  sku?: string;
  description?: string;
  unitLabel: string;
  baseSellingPriceCentavos: number;
  lowStockThreshold: number;
  allowDuplicateSku?: boolean;
};

export type InventoryMovementInput = {
  itemId: string;
  quantity: number;
  description: string;
  serviceReportId?: string;
};
