/** How long a quotation stays valid when the user does not pick a date. */
export const DEFAULT_QUOTATION_VALIDITY_DAYS = 30;

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** The date `days` after a YYYY-MM-DD date, as YYYY-MM-DD. */
export function addDaysToIsoDate(value: string, days: number): string {
  if (!isIsoDate(value)) throw new Error('Date must use YYYY-MM-DD.');
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function defaultValidUntil(businessDate: string): string {
  return addDaysToIsoDate(businessDate, DEFAULT_QUOTATION_VALIDITY_DAYS);
}

/** A quotation is valid from its own date; the end date may not come before it. */
export function validateValidUntil(validUntil: string, businessDate: string): void {
  if (!isIsoDate(validUntil)) throw new Error('Valid-until date must use YYYY-MM-DD.');
  if (validUntil < businessDate) throw new Error('A quotation cannot expire before its own date.');
}

export function isQuotationExpired(validUntil: string, today: string): boolean {
  return validUntil < today;
}
