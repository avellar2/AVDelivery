export type AsaasCustomer = {
  id: string;
  name: string;
  email: string | null;
  cpfCnpj: string | null;
  externalReference: string | null;
};

export type AsaasSubscription = {
  id: string;
  customer: string;
  billingType: string;
  value: number;
  nextDueDate: string;
  cycle: string;
  status: string;
  externalReference: string | null;
  description: string | null;
};

export type AsaasPayment = {
  id: string;
  customer: string;
  subscription: string | null;
  billingType: string;
  value: number;
  status: string;
  dueDate: string;
  paymentDate: string | null;
  confirmedDate: string | null;
  clientPaymentDate: string | null;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  externalReference: string | null;
  description: string | null;
  deleted: boolean;
};

export type AsaasPixQrCode = {
  encodedImage: string;
  payload: string;
  expirationDate: string | null;
};

export type AsaasCustomerInput = {
  storeId: string;
  legalName: string;
  document: string;
  email: string;
  phone: string;
  postalCode: string | null;
  address: string | null;
  addressNumber: string | null;
  complement: string | null;
  province: string | null;
};

export type AsaasSubscriptionInput = {
  customerId: string;
  storeId: string;
  valueCents: number;
  nextDueDate: string;
  description: string;
};
