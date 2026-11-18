type SearchableService = {
  name: string;
  description: string;
  active: boolean;
};

/** Case-insensitive match on name and description; an empty search keeps every service. */
export function filterServicesByQuery<T extends SearchableService>(services: readonly T[], query: string): T[] {
  const text = query.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!text) return [...services];
  return services.filter((service) => [service.name, service.description].some((value) => value.toLowerCase().includes(text)));
}

/** The same search, but inactive services are never offered for new work. */
export function filterServicesForSelection<T extends SearchableService>(services: readonly T[], query: string): T[] {
  return filterServicesByQuery(services, query).filter((service) => service.active);
}
