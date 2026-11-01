export function normalizeCustomerName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function assertOptionalEmail(value: string): void {
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error('Enter a valid email address.');
  }
}

type SearchableCustomer = {
  name: string;
  address: string;
  contactNumber: string;
  email: string;
  active: boolean;
};

/** Case-insensitive match on name, address, phone and email; inactive customers are never offered for new work. */
export function filterCustomersForSelection<T extends SearchableCustomer>(customers: readonly T[], query: string): T[] {
  const text = normalizeCustomerName(query).toLowerCase();
  const digits = text.replace(/\D/g, '');
  return customers.filter((customer) => {
    if (!customer.active) return false;
    if (!text) return true;
    if ([customer.name, customer.address, customer.email].some((value) => value.toLowerCase().includes(text))) return true;
    // Phone numbers are stored as typed, so compare digits to ignore spaces and dashes.
    return digits.length >= 3 && customer.contactNumber.replace(/\D/g, '').includes(digits);
  });
}
