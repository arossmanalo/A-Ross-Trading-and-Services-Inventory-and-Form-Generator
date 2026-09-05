export type ServiceCatalogEntry = {
  id: string;
  name: string;
  description: string;
  baseRateCentavos: number;
  active: boolean;
};

export type SaveServiceInput = {
  name: string;
  description?: string;
  baseRateCentavos: number;
};
