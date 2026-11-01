type SearchableService = {
  name: string;
  description: string;
  active: boolean;
};

/** Case-insensitive match on name and description; inactive services are never offered for new work. */
export function filterServicesForSelection<T extends SearchableService>(services: readonly T[], query: string): T[] {
  const text = query.trim().replace(/\s+/g, ' ').toLowerCase();
  return services.filter((service) => {
    if (!service.active) return false;
    if (!text) return true;
    return [service.name, service.description].some((value) => value.toLowerCase().includes(text));
  });
}
