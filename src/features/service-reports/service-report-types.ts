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

export type ServiceReportDetail = ServiceReportSummary & ServiceReportFields & {
  customerId: string;
  equipmentId: string;
  followsCsrId: string | null;
  backdateReason: string | null;
  signatureStatus: string;
  shareState: 'not_shared' | 'shared';
  finalizedAt: string | null;
  usages: ServiceReportUsage[];
  services: ServiceReportServiceUsage[];
};

export type CreateServiceReportDraftInput = {
  customerId: string;
  equipmentId: string;
  followsCsrId?: string;
  businessDate: string;
  backdateReason?: string;
};

export type UpdateServiceReportDraftInput = EditableServiceReportFields & {
  serviceOutcome: ServiceOutcome;
  businessDate: string;
  backdateReason?: string;
};
