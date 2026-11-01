import { describe, expect, it } from 'vitest';

import { filterItemsForSelection } from './item-search';

const item = (name: string, extra: Partial<{ sku: string | null; unitLabel: string; active: boolean }> = {}) => ({
  name, sku: null, unitLabel: 'pc', active: true, ...extra,
});

describe('inventory item selection search', () => {
  const items = [
    item('Liquid Detergent', { sku: 'LD-001', unitLabel: 'carboy' }),
    item('Drain Hose', { sku: 'DH-9' }),
    item('Old Gasket', { active: false }),
  ];

  it('lists every active item for an empty search and hides inactive ones', () => {
    expect(filterItemsForSelection(items, '   ').map((entry) => entry.name)).toEqual(['Liquid Detergent', 'Drain Hose']);
  });

  it('matches name, SKU and unit regardless of case or repeated spaces', () => {
    expect(filterItemsForSelection(items, ' liquid   DETERGENT ').map((entry) => entry.name)).toEqual(['Liquid Detergent']);
    expect(filterItemsForSelection(items, 'dh-9').map((entry) => entry.name)).toEqual(['Drain Hose']);
    expect(filterItemsForSelection(items, 'carboy').map((entry) => entry.name)).toEqual(['Liquid Detergent']);
  });

  it('never returns an inactive item even when it matches', () => {
    expect(filterItemsForSelection(items, 'gasket')).toEqual([]);
  });
});
