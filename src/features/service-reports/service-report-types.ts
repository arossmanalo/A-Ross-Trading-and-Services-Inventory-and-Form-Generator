export type ServiceOutcome = 'completed' | 'incomplete' | 'under_observation' | 'waiting_for_parts';
export type DocumentState = 'draft' | 'finalized' | 'voided';

export type ServiceReportFields = {
  reportedProblem: string[];
  diagnosis: string[];
  actionTaken: string[];
  recommendations: string[];
  billing: string[];
  customerRemarks: string[];
  machineStatus: string;
  warrantyText: string;
  servicedBy: string;
  acknowledgedBy: string;
  totalBillCentavos: number;
};

export type EditableServiceReportFields = Omit<ServiceReportFields, 'totalBillCentavos'>;

export type ServiceReportSummary = {
  id: string;
  csrNumber: string | null;
  customerName: string;
  equipmentName: string;
  documentState: DocumentState;
  serviceOutcome: ServiceOutcome;
  businessDate: string;
  pdfState: 'error' | 'not_generated' | 'pending' | 'ready';
};

export type ServiceReportUsage = {
  id: string;
  itemId: string;
  itemName: string;
  itemSku: string | null;
  unitLabel: string;
  quantity: number;
  currentStock: number;
  billable: boolean;
  resolvedSellingPriceCentavos: number | null;
  priceSource: 'base' | 'customer' | 'override' | null;
  overrideReason: string | null;
};

export type ServiceReportServiceUsage = {
  id: string;
  serviceId: string;
  serviceName: string;
  quantity: 1;
  resolvedRateCentavos: number;
  rateSource: 'catalog' | 'override';
  overrideReason: string | null;
};

export type ServiceReportMachine = {
  equipmentId: string;
  machineType: string;
  model: string;
  serialNumber: string;
  nicknameOrLocation: string;
};

export type ServiceReportDetail = ServiceReportSummary & ServiceReportFields & {
  customerId: string;
  /** Primary machine. Every machine, including this one, is listed in `machines`. */
  equipmentId: string;
  machines: ServiceReportMachine[];
  machineCount: number;
  followsCsrId: string | null;
  signatureStatus: string;
  hasSignedVersion: boolean;
  shareState: 'not_shared' | 'shared';
  finalizedAt: string | null;
  usages: ServiceReportUsage[];
  services: ServiceReportServiceUsage[];
  customerType: 'individual' | 'company';
  acknowledgmentOptions: string[];
};

export type CreateServiceReportDraftInput = {
  customerId: string;
  /** Primary machine. */
  equipmentId: string;
  /** Further machines serviced during the same visit. */
  additionalEquipmentIds?: string[];
  followsCsrId?: string;
  businessDate: string;
};

export type UpdateServiceReportDraftInput = EditableServiceReportFields & {
  serviceOutcome: ServiceOutcome;
  businessDate: string;
};
