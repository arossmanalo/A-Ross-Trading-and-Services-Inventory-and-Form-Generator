export type CustomerSummary = {
  id: string;
  name: string;
  address: string;
  contactNumber: string;
  email: string;
  active: boolean;
  equipmentCount: number;
};

export type CustomerEquipment = {
  id: string;
  customerId: string;
  machineType: string;
  model: string;
  serialNumber: string;
  nicknameOrLocation: string;
  notes: string;
  active: boolean;
};

export type CustomerDetail = CustomerSummary & {
  equipment: CustomerEquipment[];
};

export type CreateCustomerInput = {
  name: string;
  address?: string;
  contactNumber?: string;
  email?: string;
  allowDuplicateName?: boolean;
};

export type CreateEquipmentInput = {
  customerId: string;
  machineType: string;
  model?: string;
  serialNumber?: string;
  nicknameOrLocation?: string;
  notes?: string;
};
