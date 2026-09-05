const PHP_FORMATTER = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export type Discount =
  | { type: 'fixed'; valueCentavos: number }
  | { type: 'percentage'; basisPoints: number }
  | null;

export function parseCurrencyToCentavos(value: string): number {
  const normalized = value.replace(/[₱,\s]/g, '');

  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) {
    throw new Error('Enter a valid non-negative amount with at most two decimal places.');
  }

  const [whole, fraction = ''] = normalized.split('.');
  const centavos = Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, '0'), 10);

  if (!Number.isSafeInteger(centavos)) {
    throw new Error('Amount is too large.');
  }

  return centavos;
}

export function formatCentavos(valueCentavos: number): string {
  assertNonNegativeCentavos(valueCentavos, 'Amount');
  return PHP_FORMATTER.format(valueCentavos / 100);
}

export function calculateDiscountCentavos(
  subtotalCentavos: number,
  discount: Discount,
): number {
  assertNonNegativeCentavos(subtotalCentavos, 'Subtotal');

  if (!discount) {
    return 0;
  }

  if (discount.type === 'fixed') {
    assertNonNegativeCentavos(discount.valueCentavos, 'Discount');
    if (discount.valueCentavos > subtotalCentavos) {
      throw new Error('Fixed discount cannot exceed the subtotal.');
    }
    return discount.valueCentavos;
  }

  if (!Number.isInteger(discount.basisPoints) || discount.basisPoints < 0 || discount.basisPoints > 10_000) {
    throw new Error('Percentage discount must be between 0% and 100%.');
  }

  return Math.round((subtotalCentavos * discount.basisPoints) / 10_000);
}

export function calculateDiscountedTotalCentavos(
  lineAmountsCentavos: readonly number[],
  discount: Discount,
): number {
  const subtotal = lineAmountsCentavos.reduce((sum, amount) => {
    assertNonNegativeCentavos(amount, 'Line amount');
    return sum + amount;
  }, 0);

  return subtotal - calculateDiscountCentavos(subtotal, discount);
}

function assertNonNegativeCentavos(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer number of centavos.`);
  }
}
