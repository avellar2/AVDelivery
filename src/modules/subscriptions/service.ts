import "server-only";

import { DatabaseError } from "@/lib/errors";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { computeBillingMetrics } from "@/modules/subscriptions/access";
import type {
  AdminBillingStore,
  BillingMetrics,
  CommercialStatus,
  InvoiceSummary,
  PlanSummary,
  SubscriptionEventSummary,
  SubscriptionSummary,
} from "@/modules/subscriptions/types";
import type { CommercialState, Json } from "@/types/database";

const COMMERCIAL_STATES: readonly CommercialState[] = [
  "missing",
  "inactive",
  "trialing",
  "active",
  "grace",
  "exempt",
  "expired",
  "canceled",
];

function toCommercialState(value: unknown): CommercialState {
  return typeof value === "string" && COMMERCIAL_STATES.includes(value as CommercialState)
    ? (value as CommercialState)
    : "missing";
}

function asRecord(value: Json | unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parsePlan(value: unknown): PlanSummary | null {
  const plan = asRecord(value);

  if (!plan || typeof plan.id !== "string") {
    return null;
  }

  return {
    id: plan.id,
    code: String(plan.code ?? ""),
    name: String(plan.name ?? ""),
    priceCents: asNumber(plan.priceCents),
    currency: String(plan.currency ?? "BRL"),
    billingInterval: "monthly",
    trialDays: asNumber(plan.trialDays),
    graceDays: asNumber(plan.graceDays),
    active: true,
  };
}

export function parseSubscriptionSummary(value: Json | null): SubscriptionSummary | null {
  const data = asRecord(value);
  const plan = parsePlan(data?.plan);

  if (!data || !plan || typeof data.subscriptionId !== "string") {
    return null;
  }

  return {
    subscriptionId: data.subscriptionId,
    storeId: String(data.storeId ?? ""),
    status:
      data.status === "trialing" ||
      data.status === "active" ||
      data.status === "grace" ||
      data.status === "expired" ||
      data.status === "canceled"
        ? data.status
        : "expired",
    state: toCommercialState(data.state),
    hasAccess: data.hasAccess === true,
    isExempt: data.isExempt === true,
    exemptionReason: asString(data.exemptionReason),
    trialStartedAt: asString(data.trialStartedAt),
    trialEndsAt: asString(data.trialEndsAt),
    currentPeriodStart: asString(data.currentPeriodStart),
    currentPeriodEnd: asString(data.currentPeriodEnd),
    graceEndsAt: asString(data.graceEndsAt),
    canceledAt: asString(data.canceledAt),
    createdAt: String(data.createdAt ?? ""),
    updatedAt: String(data.updatedAt ?? ""),
    serverNow: String(data.serverNow ?? new Date().toISOString()),
    plan,
  };
}

export async function listActivePlans(): Promise<PlanSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("plans")
    .select(
      "id, code, name, price_cents, currency, billing_interval, trial_days, grace_days, active",
    )
    .eq("active", true)
    .order("price_cents", { ascending: true });

  if (error) {
    throw new DatabaseError("subscriptions.listPlans", error);
  }

  return (data ?? []).map((plan) => ({
    id: plan.id,
    code: plan.code,
    name: plan.name,
    priceCents: plan.price_cents,
    currency: plan.currency.trim(),
    billingInterval: plan.billing_interval,
    trialDays: plan.trial_days,
    graceDays: plan.grace_days,
    active: plan.active,
  }));
}

export async function getAdminBillingOverview(): Promise<AdminBillingStore[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_store_billing");

  if (error) {
    throw new DatabaseError("subscriptions.adminOverview", error);
  }

  return (data ?? []).map((row) => ({
    storeId: row.store_id,
    name: row.name,
    slug: row.slug,
    active: row.active,
    createdAt: row.created_at,
    memberCount: asNumber(row.member_count),
    ownerCount: asNumber(row.owner_count),
    subscriptionId: row.subscription_id,
    status: row.status,
    isExempt: row.is_exempt === true,
    planId: row.plan_id,
    planName: row.plan_name,
    priceCents: row.price_cents === null ? null : asNumber(row.price_cents),
    currency: row.currency?.trim() ?? null,
    trialStartedAt: row.trial_started_at,
    trialEndsAt: row.trial_ends_at,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    graceEndsAt: row.grace_ends_at,
    canceledAt: row.canceled_at,
    state: toCommercialState(row.effective_state),
  }));
}

export async function getAdminBillingStore(storeId: string): Promise<AdminBillingStore | null> {
  const stores = await getAdminBillingOverview();
  return stores.find((store) => store.storeId === storeId) ?? null;
}

export async function getAdminInvoices(storeId: string): Promise<InvoiceSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id, amount_cents, currency, status, period_start, period_end, due_at, paid_at, external_provider, external_payment_id, billing_type, external_status, payment_url, pix_payload",
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new DatabaseError("subscriptions.adminInvoices", error);
  }

  return (data ?? []).map((invoice) => ({
    id: invoice.id,
    amountCents: invoice.amount_cents,
    currency: invoice.currency.trim(),
    status: invoice.status,
    periodStart: invoice.period_start,
    periodEnd: invoice.period_end,
    dueAt: invoice.due_at,
    paidAt: invoice.paid_at,
    externalProvider: invoice.external_provider,
    externalPaymentId: invoice.external_payment_id,
    billingType: invoice.billing_type,
    externalStatus: invoice.external_status,
    paymentUrl: invoice.payment_url,
    pixPayload: invoice.pix_payload,
  }));
}

export async function getSubscriptionEvents(storeId: string): Promise<SubscriptionEventSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("subscription_events")
    .select("id, event_type, actor_id, reason, metadata, created_at")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) {
    throw new DatabaseError("subscriptions.adminEvents", error);
  }

  return (data ?? []).map((event) => ({
    id: event.id,
    eventType: event.event_type,
    actorId: event.actor_id,
    reason: event.reason,
    metadata: asRecord(event.metadata) ?? {},
    createdAt: event.created_at,
  }));
}

export async function getOwnerSubscription(storeId: string): Promise<SubscriptionSummary | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_store_subscription", {
    p_store_id: storeId,
  });

  if (error) {
    throw new DatabaseError("subscriptions.ownerDetail", error);
  }

  return parseSubscriptionSummary(data);
}

export async function getOwnerInvoices(storeId: string): Promise<InvoiceSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id, amount_cents, currency, status, period_start, period_end, due_at, paid_at, external_provider, external_payment_id, billing_type, external_status, payment_url, pix_payload",
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(24);

  if (error) {
    throw new DatabaseError("subscriptions.ownerInvoices", error);
  }

  return (data ?? []).map((invoice) => ({
    id: invoice.id,
    amountCents: invoice.amount_cents,
    currency: invoice.currency.trim(),
    status: invoice.status,
    periodStart: invoice.period_start,
    periodEnd: invoice.period_end,
    dueAt: invoice.due_at,
    paidAt: invoice.paid_at,
    externalProvider: invoice.external_provider,
    externalPaymentId: invoice.external_payment_id,
    billingType: invoice.billing_type,
    externalStatus: invoice.external_status,
    paymentUrl: invoice.payment_url,
    pixPayload: invoice.pix_payload,
  }));
}

export async function getCommercialStatusBySlug(slug: string): Promise<CommercialStatus | null> {
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.rpc("get_store_commercial_status", {
    p_store_slug: slug,
  });

  if (error) {
    throw new DatabaseError("subscriptions.commercialStatus", error);
  }

  const record = asRecord(data);

  if (!record) {
    return null;
  }

  return {
    storeActive: record.storeActive === true,
    state: toCommercialState(record.state),
    hasAccess: record.hasAccess === true,
  };
}

export async function getReceivedThisMonthCents(): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data, error } = await supabase
    .from("invoices")
    .select("amount_cents")
    .eq("status", "paid")
    .gte("paid_at", monthStart);

  if (error) {
    throw new DatabaseError("subscriptions.receivedThisMonth", error);
  }

  return (data ?? []).reduce((total, invoice) => total + asNumber(invoice.amount_cents), 0);
}

export async function getBillingMetrics(
  stores?: AdminBillingStore[],
): Promise<{ stores: AdminBillingStore[]; metrics: BillingMetrics }> {
  const rows = stores ?? (await getAdminBillingOverview());
  const receivedThisMonthCents = await getReceivedThisMonthCents();

  return {
    stores: rows,
    metrics: computeBillingMetrics(rows, receivedThisMonthCents),
  };
}

export async function getAdminStoreRecord(storeId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("stores")
    .select("id, name, slug, description, phone, active, created_at")
    .eq("id", storeId)
    .maybeSingle();

  if (error) {
    throw new DatabaseError("subscriptions.adminStore", error);
  }

  return data;
}
