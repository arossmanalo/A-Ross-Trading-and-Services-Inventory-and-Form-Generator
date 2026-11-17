type SearchableItem = {
  name: string;
  sku: string | null;
  unitLabel: string;
  active: boolean;
};

/** Case-insensitive match on name, SKU and unit, ignoring repeated spaces; an empty search keeps every item. */
export function filterItemsByQuery<T extends SearchableItem>(items: readonly T[], query: string): T[] {
  const text = query.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!text) return [...items];
  return items.filter((item) => [item.name, item.sku ?? '', item.unitLabel].some((value) => value.toLowerCase().includes(text)));
}

/** The same search, but inactive items are never offered for new work. */
export function filterItemsForSelection<T extends SearchableItem>(items: readonly T[], query: string): T[] {
  return filterItemsByQuery(items, query).filter((item) => item.active);
}
