export function assertPositiveIntegerQuantity(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error('Quantity must be a positive whole number.');
  }
}

export function calculateStockAfterMovement(
  currentStock: number,
  quantityDelta: number,
): number {
  if (!Number.isSafeInteger(currentStock) || currentStock < 0) {
    throw new Error('Current stock must be a non-negative whole number.');
  }
  if (!Number.isSafeInteger(quantityDelta) || quantityDelta === 0) {
    throw new Error('Stock movement must be a non-zero whole number.');
  }

  const nextStock = currentStock + quantityDelta;
  if (nextStock < 0) {
    throw new Error('Insufficient stock.');
  }

  return nextStock;
}
