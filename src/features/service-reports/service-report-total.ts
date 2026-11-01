export type TotalItem = {
  quantity: number;
  billable: boolean;
  resolvedSellingPriceCentavos: number | null;
};

export type TotalService = {
  resolvedRateCentavos: number;
};

/**
 * Item charges are quantity-based. Each service is performed on every machine
 * listed on the CSR, so service rates are multiplied by the machine count.
 */
export function calculateServiceReportTotal(items: TotalItem[], services: TotalService[], machineCount = 1): number {
  if (!Number.isSafeInteger(machineCount) || machineCount < 1) throw new Error('A CSR needs at least one machine.');
  let total = 0;
  for (const item of items) {
    if (!item.billable || item.resolvedSellingPriceCentavos === null) continue;
    total = safeAdd(total, safeMultiply(item.quantity, item.resolvedSellingPriceCentavos));
  }
  for (const service of services) {
    total = safeAdd(total, safeMultiply(machineCount, service.resolvedRateCentavos));
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
