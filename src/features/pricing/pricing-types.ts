export type CustomerItemPriceSummary = {
  id: string;
  itemId: string;
  itemName: string;
  sku: string | null;
  sellingPriceCentavos: number;
  effectiveFrom: string;
};

export type SetCustomerItemPriceInput = {
  customerId: string;
  itemId: string;
  sellingPriceCentavos: number;
};
