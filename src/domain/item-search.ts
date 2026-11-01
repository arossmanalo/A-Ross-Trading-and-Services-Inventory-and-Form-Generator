type SearchableItem = {
  name: string;
  sku: string | null;
  unitLabel: string;
  active: boolean;
};

/** Case-insensitive match on name, SKU and unit; inactive items are never offered for new work. */
export function filterItemsForSelection<T extends SearchableItem>(items: readonly T[], query: string): T[] {
  const text = query.trim().replace(/\s+/g, ' ').toLowerCase();
  return items.filter((item) => {
    if (!item.active) return false;
    if (!text) return true;
    return [item.name, item.sku ?? '', item.unitLabel].some((value) => value.toLowerCase().includes(text));
  });
}
