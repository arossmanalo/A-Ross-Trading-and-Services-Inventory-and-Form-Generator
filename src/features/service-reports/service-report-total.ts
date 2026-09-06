export type TotalItem = {
  quantity: number;
  billable: boolean;
  resolvedSellingPriceCentavos: number | null;
};

export type TotalService = {
  resolvedRateCentavos: number;
};

export function calculateServiceReportTotal(items: TotalItem[], services: TotalService[]): number {
  let total = 0;
  for (const item of items) {
    if (!item.billable || item.resolvedSellingPriceCentavos === null) continue;
    total = safeAdd(total, safeMultiply(item.quantity, item.resolvedSellingPriceCentavos));
  }
  for (const service of services) {
    total = safeAdd(total, service.resolvedRateCentavos);
  }
  return total;
}

function safeMultiply(left: number, right: number): number {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Calculated total is outside the supported amount range.');
  return result;
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Calculated total is outside the supported amount range.');
  return result;
}
