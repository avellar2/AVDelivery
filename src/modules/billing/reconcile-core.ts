import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/types/database";
import type { AsaasClientCore } from "./providers/asaas/client-core";
import { AsaasError } from "./providers/asaas/errors";
import {
  asaasValueToCents,
  canonicalAsaasPaymentStatus,
  safeInvoiceUrl,
  type CanonicalAsaasPaymentStatus,
} from "./providers/asaas/money";
import type { AsaasPayment, AsaasSubscription } from "./providers/asaas/types";
import type { AsaasWebhookEvent } from "./providers/asaas/webhook";

export type BillingAdminClient = SupabaseClient<Database>;

export class BillingProcessingError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "BillingProcessingError";
    this.reason = reason;
  }
}

export type ApplyPaymentResult = {
  applied: boolean;
  reason: string | null;
  status: CanonicalAsaasPaymentStatus | null;
  storeId: string | null;
};

function toProviderTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T12:00:00-03:00`;
  }

  return value;
}

function billingType(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return ["PIX", "BOLETO", "CREDIT_CARD", "UNDEFINED"].includes(normalized) ? normalized : null;
}

function errorCode(error: unknown): string {
  // Supabase/PostgREST errors are plain objects with a `message`, not Error
  // instances. Losing that message would classify every RPC failure as
  // `unknown` and mask permanent financial divergences as retryable.
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? (error as { message: unknown }).message
        : null;

  if (typeof message !== "string") {
    return "unknown";
  }

  return message.split("|")[0].trim() || "unknown";
}

/**
 * Applies one authoritative payment fetched from Asaas. The webhook payload
 * is never the source of truth: this function receives the object returned by
 * GET /v3/payments/{id}. The RPC re-validates store, external subscription,
 * customer, currency and amount before changing any commercial state.
 */
export async function applyProviderPayment(
  admin: BillingAdminClient,
  payment: AsaasPayment,
  context: {
    eventId: string | null;
    eventType: string | null;
    payload: Json;
  },
): Promise<ApplyPaymentResult> {
  const canonicalStatus = payment.deleted
    ? ("DELETED" as const)
    : canonicalAsaasPaymentStatus(payment.status);

  if (!canonicalStatus) {
    return {
      applied: false,
      reason: "unsupported_payment_status",
      status: null,
      storeId: null,
    };
  }

  if (!payment.subscription) {
    return {
      applied: false,
      reason: "payment_without_subscription",
      status: canonicalStatus,
      storeId: null,
    };
  }

  const amountCents = asaasValueToCents(payment.value);

  if (amountCents === null) {
    throw new BillingProcessingError("invalid_provider_amount");
  }

  const { data, error } = await admin.rpc("billing_apply_payment_event", {
    p_provider: "asaas",
    p_event_id: context.eventId,
    p_event_type: context.eventType,
    p_payment_id: payment.id,
    p_external_subscription_id: payment.subscription,
    p_external_customer_id: payment.customer,
    p_external_status: canonicalStatus,
    p_amount_cents: amountCents,
    p_currency: "BRL",
    p_due_date: payment.dueDate,
    p_paid_at: toProviderTimestamp(
      payment.confirmedDate ?? payment.paymentDate ?? payment.clientPaymentDate,
    ),
    p_payment_url: safeInvoiceUrl(payment.invoiceUrl) ?? safeInvoiceUrl(payment.bankSlipUrl),
    p_billing_type: billingType(payment.billingType),
    p_payload: context.payload,
  });

  if (error) {
    throw new BillingProcessingError(errorCode(error));
  }

  const record =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};

  return {
    applied: true,
    reason: null,
    status: canonicalStatus,
    storeId: typeof record.storeId === "string" ? record.storeId : null,
  };
}

export type SyncResult = {
  externalSubscriptionId: string;
  externalStatus: string;
  paymentsSeen: number;
  applied: number;
  ignored: number;
  failures: Array<{ paymentId: string; reason: string }>;
};

/**
 * Rerunnable reconciliation over one external subscription. It reads the
 * provider, applies every payment idempotently and only updates the external
 * status marker. Commercial access changes solely through a confirmed payment
 * inside the billing RPC. Safe to run without a worker or scheduler.
 */
export async function syncSubscriptionFromProvider(
  admin: BillingAdminClient,
  client: AsaasClientCore,
  subscription: AsaasSubscription,
  options: { eventType?: string } = {},
): Promise<SyncResult> {
  const payments = await client.listSubscriptionPayments(subscription.id, { limit: 30 });
  const scoped = payments.filter((payment) => payment.subscription === subscription.id);
  let applied = 0;
  let ignored = 0;
  const failures: SyncResult["failures"] = [];

  for (const payment of scoped) {
    try {
      const result = await applyProviderPayment(admin, payment, {
        eventId: null,
        eventType: options.eventType ?? "RECONCILIATION",
        payload: { source: "reconciliation", paymentId: payment.id },
      });

      if (result.applied) {
        applied += 1;
      } else {
        ignored += 1;
      }
    } catch (error) {
      failures.push({
        paymentId: payment.id,
        reason: error instanceof BillingProcessingError ? error.reason : "processing_error",
      });
    }
  }

  const { error } = await admin.rpc("billing_update_external_subscription_status", {
    p_external_subscription_id: subscription.id,
    p_external_status: subscription.status,
    p_event_id: null,
    p_payload: { source: "reconciliation" },
  });

  if (error) {
    throw new BillingProcessingError(errorCode(error));
  }

  return {
    externalSubscriptionId: subscription.id,
    externalStatus: subscription.status,
    paymentsSeen: scoped.length,
    applied,
    ignored,
    failures,
  };
}

export type WebhookProcessResult = {
  outcome: "processed" | "ignored";
  detail: string;
  storeId: string | null;
};

/**
 * Fetches the resource named by the webhook from Asaas and applies the
 * authoritative state. Out-of-order events are safe because each payment has
 * its own id and the database protects paid/refunded states from downgrade.
 */
export async function processAsaasWebhookEvent(
  admin: BillingAdminClient,
  client: AsaasClientCore,
  event: AsaasWebhookEvent,
): Promise<WebhookProcessResult> {
  if (event.resourceType === "payment") {
    if (!event.paymentId) {
      return { outcome: "ignored", detail: "missing_payment_id", storeId: null };
    }

    if (event.eventType === "PAYMENT_PARTIALLY_REFUNDED") {
      // A partial refund does not map to the local invoice model. It is kept
      // for manual review instead of guessing a commercial state.
      return { outcome: "ignored", detail: "manual_review_partial_refund", storeId: null };
    }

    let payment: AsaasPayment;

    try {
      payment = await client.getPayment(event.paymentId);
    } catch (error) {
      if (error instanceof AsaasError && error.code === "NOT_FOUND") {
        return { outcome: "ignored", detail: "provider_payment_not_found", storeId: null };
      }

      throw error;
    }

    if (payment.id !== event.paymentId) {
      return { outcome: "ignored", detail: "provider_payment_mismatch", storeId: null };
    }

    const result = await applyProviderPayment(admin, payment, {
      eventId: event.eventId,
      eventType: event.eventType,
      payload: event.payload as Json,
    });

    if (!result.applied) {
      return {
        outcome: "ignored",
        detail: result.reason ?? "payment_not_applied",
        storeId: result.storeId,
      };
    }

    return {
      outcome: "processed",
      detail: `payment_${result.status?.toLowerCase() ?? "updated"}`,
      storeId: result.storeId,
    };
  }

  if (event.resourceType === "subscription") {
    if (!event.subscriptionId) {
      return { outcome: "ignored", detail: "missing_subscription_id", storeId: null };
    }

    let subscription: AsaasSubscription;

    try {
      subscription = await client.getSubscription(event.subscriptionId);
    } catch (error) {
      if (error instanceof AsaasError && error.code === "NOT_FOUND") {
        return { outcome: "ignored", detail: "provider_subscription_not_found", storeId: null };
      }

      throw error;
    }

    const { data, error } = await admin.rpc("billing_update_external_subscription_status", {
      p_external_subscription_id: subscription.id,
      p_external_status: subscription.status,
      p_event_id: event.eventId,
      p_payload: event.payload as Json,
    });

    if (error) {
      throw new BillingProcessingError(errorCode(error));
    }

    const record =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};

    return {
      outcome: "processed",
      detail: `subscription_${subscription.status.toLowerCase()}`,
      storeId: typeof record.storeId === "string" ? record.storeId : null,
    };
  }

  return { outcome: "ignored", detail: "unsupported_resource", storeId: null };
}
