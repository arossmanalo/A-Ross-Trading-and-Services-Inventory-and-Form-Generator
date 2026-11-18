type SearchablePayment = {
  paNumber: string;
  billingStatementNumber: string;
  serviceReportNumber: string | null;
  customerName: string;
  referenceNumber: string | null;
  method: string;
};

/** Case-insensitive match on the PA, statement and CSR numbers, customer, reference and method. */
export function filterPaymentsByQuery<T extends SearchablePayment>(payments: readonly T[], query: string): T[] {
  const text = query.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!text) return [...payments];
  return payments.filter((payment) => [
    payment.paNumber,
    payment.billingStatementNumber,
    payment.serviceReportNumber ?? '',
    payment.customerName,
    payment.referenceNumber ?? '',
    payment.method.replaceAll('_', ' '),
  ].some((value) => value.toLowerCase().includes(text)));
}
