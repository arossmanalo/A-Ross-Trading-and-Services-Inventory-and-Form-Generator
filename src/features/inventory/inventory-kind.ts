import type { ChoiceOption } from '@/components/choice-chips';
import type { InventoryKind } from '@/features/inventory/inventory-types';

/**
 * The stored key for parts is 'supply' (its first name, already saved on the
 * tablet); everything people see calls them Parts.
 */
export const INVENTORY_LABELS: Record<InventoryKind, { singular: string; plural: string; route: '/parts' | '/products' }> = {
  supply: { singular: 'Part', plural: 'Parts', route: '/parts' },
  product: { singular: 'Product', plural: 'Products', route: '/products' },
};

export const INVENTORY_KIND_OPTIONS: readonly ChoiceOption<InventoryKind>[] = [
  { value: 'supply', label: 'Parts (used on repairs)' },
  { value: 'product', label: 'Products (sold to customers)' },
];

/** Reads an inventory kind from a route parameter; anything else is not one. */
export function parseInventoryKind(value: string | undefined): InventoryKind | null {
  return value === 'supply' || value === 'product' ? value : null;
}
