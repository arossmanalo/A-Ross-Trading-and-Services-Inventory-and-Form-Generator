import { describe, expect, it } from 'vitest';

import { filterServicesForSelection } from './service-search';

const service = (name: string, extra: Partial<{ description: string; active: boolean }> = {}) => ({
  name, description: '', active: true, ...extra,
});

describe('service selection search', () => {
  const services = [
    service('Labor', { description: 'Per machine technician time' }),
    service('Deep Cleaning'),
    service('Retired Inspection', { active: false }),
  ];

  it('lists every active service for an empty search and hides inactive ones', () => {
    expect(filterServicesForSelection(services, ' ').map((entry) => entry.name)).toEqual(['Labor', 'Deep Cleaning']);
  });

  it('matches name and description regardless of case or spacing', () => {
    expect(filterServicesForSelection(services, ' deep   CLEAN').map((entry) => entry.name)).toEqual(['Deep Cleaning']);
    expect(filterServicesForSelection(services, 'technician').map((entry) => entry.name)).toEqual(['Labor']);
  });

  it('never returns an inactive service', () => {
    expect(filterServicesForSelection(services, 'inspection')).toEqual([]);
  });
});
