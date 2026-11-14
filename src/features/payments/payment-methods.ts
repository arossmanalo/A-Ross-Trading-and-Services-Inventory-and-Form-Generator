import type { ChoiceOption } from '@/components/choice-chips';
import type { PaymentMethod } from '@/features/payments/payment-types';

export const PAYMENT_METHOD_OPTIONS: readonly ChoiceOption<PaymentMethod>[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'e_wallet', label: 'GCash / E-wallet' },
  { value: 'check', label: 'Check' },
  { value: 'other', label: 'Other' },
];
