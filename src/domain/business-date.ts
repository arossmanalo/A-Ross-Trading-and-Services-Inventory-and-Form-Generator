export function getLocalBusinessDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Business dates may be in the past without a reason; only malformed and future dates are rejected. */
export function validateBusinessDate(value: string, today = getLocalBusinessDate()): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00`))) {
    throw new Error('Business date must use YYYY-MM-DD.');
  }
  if (value > today) throw new Error('Business date cannot be in the future.');
}
