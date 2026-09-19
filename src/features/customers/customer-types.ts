export type CustomerType = 'individual' | 'company';

export type CustomerSummary = {
  id: string;
  name: string;
  address: string;
  contactNumber: string;
  email: string;
  active: boolean;
  equipmentCount: number;
  customerType: CustomerType;
  memberCount: number;
};

export type CustomerMember = {
  id: string;
  customerId: string;
  name: string;
  contactNumber: string;
  email: string;
  active: boolean;
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
  members: CustomerMember[];
};

export type CreateCustomerInput = {
  name: string;
  address?: string;
  contactNumber?: string;
  email?: string;
  customerType?: CustomerType;
  initialMember?: { name: string; contactNumber?: string; email?: string };
  allowDuplicateName?: boolean;
};

export type CreateCustomerMemberInput = {
  customerId: string;
  name: string;
  contactNumber?: string;
  email?: string;
};

export type CreateEquipmentInput = {
  customerId: string;
  machineType: string;
  model?: string;
  serialNumber?: string;
  nicknameOrLocation?: string;
  notes?: string;
};
