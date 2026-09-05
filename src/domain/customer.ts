export function normalizeCustomerName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function assertOptionalEmail(value: string): void {
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error('Enter a valid email address.');
  }
}
