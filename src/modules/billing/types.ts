export type BillingProfile = {
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
  externalCustomerId: string | null;
  updatedAt: string | null;
};

export type BillingConnection = {
  provider: "asaas";
  environment: "sandbox";
  configured: boolean;
  missing: string[];
};

export type OwnerBillingSubscription = {
  externalProvider: string | null;
  externalSubscriptionId: string | null;
  externalStatus: string | null;
  lastSyncedAt: string | null;
};

export type OwnerCheckoutSummary = {
  status: string;
  externalSubscriptionId: string | null;
  firstPaymentId: string | null;
  paymentUrl: string | null;
  pixPayload: string | null;
  errorMessage: string | null;
  createdAt: string;
  expiresAt: string | null;
};
