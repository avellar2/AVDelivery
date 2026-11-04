import type { CommercialState, SubscriptionStatus } from "@/types/database";
import type { AdminBillingStore, BillingMetrics } from "@/modules/subscriptions/types";

const DAY_MS = 86_400_000;

export const COMMERCIAL_ACCESS_STATES: readonly CommercialState[] = [
  "trialing",
  "active",
  "grace",
  "exempt",
];

export type SubscriptionStateInput = {
  status: SubscriptionStatus;
  isExempt: boolean;
  trialEndsAt: string | Date | null;
  currentPeriodEnd: string | Date | null;
  graceEndsAt: string | Date | null;
  graceDays: number;
};

function toTime(value: string | Date | null): number | null {
  if (!value) {
    return null;
  }

  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * Mirrors private.effective_subscription_state in the database.
 * Dates are inclusive: an end timestamp still grants access at exactly that
 * instant; one millisecond later the subscription is in grace or expired.
 */
export function effectiveSubscriptionState(
  input: SubscriptionStateInput,
  now: Date = new Date(),
): CommercialState {
  if (input.status === "canceled") {
    return "canceled";
  }

  if (input.status === "expired") {
    return "expired";
  }

  if (input.isExempt) {
    return "exempt";
  }

  const at = now.getTime();
  const graceMs = Math.max(0, input.graceDays) * DAY_MS;

  if (input.status === "grace") {
    const graceEnd = toTime(input.graceEndsAt);
    return graceEnd !== null && at <= graceEnd ? "grace" : "expired";
  }

  if (input.status === "trialing") {
    const trialEnd = toTime(input.trialEndsAt);

    if (trialEnd === null) {
      return "expired";
    }

    if (at <= trialEnd) {
      return "trialing";
    }

    return at <= trialEnd + graceMs ? "grace" : "expired";
  }

  if (input.status === "active") {
    const periodEnd = toTime(input.currentPeriodEnd);

    if (periodEnd === null) {
      return "expired";
    }

    if (at <= periodEnd) {
      return "active";
    }

    const graceEnd = toTime(input.graceEndsAt) ?? periodEnd + graceMs;
    return at <= graceEnd ? "grace" : "expired";
  }

  return "expired";
}

export function hasCommercialAccess(state: CommercialState): boolean {
  return COMMERCIAL_ACCESS_STATES.includes(state);
}

export function isCommerciallyBlocked(state: CommercialState): boolean {
  return !hasCommercialAccess(state) && state !== "inactive";
}

export function daysRemaining(end: string | Date | null, now: Date = new Date()): number | null {
  const target = toTime(end);

  if (target === null) {
    return null;
  }

  return Math.max(0, Math.ceil((target - now.getTime()) / DAY_MS));
}

export function commercialStateLabel(state: CommercialState): string {
  switch (state) {
    case "trialing":
      return "Período de teste";
    case "active":
      return "Ativa";
    case "grace":
      return "Em carência";
    case "exempt":
      return "Isenta (administrativa)";
    case "expired":
      return "Vencida";
    case "canceled":
      return "Cancelada";
    case "inactive":
      return "Loja inativa";
    case "missing":
    default:
      return "Sem assinatura";
  }
}

export function commercialStateTone(
  state: CommercialState,
): "neutral" | "success" | "warning" | "danger" | "brand" {
  switch (state) {
    case "active":
      return "success";
    case "trialing":
    case "exempt":
      return "brand";
    case "grace":
      return "warning";
    case "expired":
    case "canceled":
      return "danger";
    default:
      return "neutral";
  }
}

/**
 * Nominal MRR counts only paying, non-exempt active subscriptions.
 * Trials, grace, expired, canceled, missing and administrative exemptions are
 * not revenue and must never be presented as received money.
 */
export function computeMrrCents(stores: readonly AdminBillingStore[]): number {
  return stores.reduce((total, store) => {
    if (store.state !== "active" || store.isExempt) {
      return total;
    }

    return total + (store.priceCents ?? 0);
  }, 0);
}

export function computeBillingMetrics(
  stores: readonly AdminBillingStore[],
  receivedThisMonthCents: number,
): BillingMetrics {
  const metrics: BillingMetrics = {
    totalStores: stores.length,
    trialing: 0,
    active: 0,
    grace: 0,
    expired: 0,
    canceled: 0,
    exempt: 0,
    missing: 0,
    mrrCents: computeMrrCents(stores),
    receivedThisMonthCents,
  };

  for (const store of stores) {
    switch (store.state) {
      case "trialing":
        metrics.trialing += 1;
        break;
      case "active":
        metrics.active += 1;
        break;
      case "grace":
        metrics.grace += 1;
        break;
      case "expired":
        metrics.expired += 1;
        break;
      case "canceled":
        metrics.canceled += 1;
        break;
      case "exempt":
        metrics.exempt += 1;
        break;
      case "missing":
        metrics.missing += 1;
        break;
      default:
        break;
    }
  }

  return metrics;
}

export function canViewSubscription(role: string | null | undefined): boolean {
  return role === "owner";
}

export function canManagePlatformBilling(isPlatformAdmin: boolean): boolean {
  return isPlatformAdmin;
}
