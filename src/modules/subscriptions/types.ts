import type {
  BillingInterval,
  CommercialState,
  InvoiceStatus,
  SubscriptionStatus,
} from "@/types/database";

export type PlanSummary = {
  id: string;
  code: string;
  name: string;
  priceCents: number;
  currency: string;
  billingInterval: BillingInterval;
  trialDays: number;
  graceDays: number;
  active: boolean;
};

export type SubscriptionSummary = {
  subscriptionId: string;
  storeId: string;
  status: SubscriptionStatus;
  state: CommercialState;
  hasAccess: boolean;
  isExempt: boolean;
  exemptionReason: string | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
  serverNow: string;
  plan: PlanSummary;
};

export type AdminBillingStore = {
  storeId: string;
  name: string;
  slug: string;
  active: boolean;
  createdAt: string;
  memberCount: number;
  ownerCount: number;
  subscriptionId: string | null;
  status: SubscriptionStatus | null;
  isExempt: boolean;
  planId: string | null;
  planName: string | null;
  priceCents: number | null;
  currency: string | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
  canceledAt: string | null;
  state: CommercialState;
};

export type InvoiceSummary = {
  id: string;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  periodStart: string;
  periodEnd: string;
  dueAt: string;
  paidAt: string | null;
  externalProvider: string | null;
  externalPaymentId: string | null;
  billingType: string | null;
  externalStatus: string | null;
  paymentUrl: string | null;
  pixPayload: string | null;
};

export type SubscriptionEventSummary = {
  id: string;
  eventType: string;
  actorId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CommercialStatus = {
  storeActive: boolean;
  state: CommercialState;
  hasAccess: boolean;
};

export type BillingMetrics = {
  totalStores: number;
  trialing: number;
  active: number;
  grace: number;
  expired: number;
  canceled: number;
  exempt: number;
  missing: number;
  mrrCents: number;
  receivedThisMonthCents: number;
};
