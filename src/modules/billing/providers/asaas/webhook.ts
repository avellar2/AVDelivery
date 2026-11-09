import { z } from "zod";

import { timingSafeTokenMatches } from "@/lib/timing-safe";

export const ASAAS_WEBHOOK_MAX_BYTES = 256 * 1024;

const webhookSchema = z
  .object({
    id: z.string().trim().min(3).max(200),
    event: z
      .string()
      .trim()
      .min(3)
      .max(80)
      .regex(/^[A-Z0-9_]+$/, "Evento inválido."),
    dateCreated: z.string().nullish(),
    payment: z
      .object({
        id: z.string().trim().min(3).max(120),
        subscription: z.string().nullish(),
        customer: z.string().nullish(),
        status: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
    subscription: z
      .object({
        id: z.string().trim().min(3).max(120),
        status: z.string().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

export type AsaasWebhookEvent = {
  eventId: string;
  eventType: string;
  dateCreated: string | null;
  paymentId: string | null;
  subscriptionId: string | null;
  resourceType: "payment" | "subscription" | null;
  resourceId: string | null;
  payload: Record<string, unknown>;
};

export type WebhookParseResult =
  { ok: true; event: AsaasWebhookEvent } | { ok: false; reason: "invalid_structure" };

/**
 * Parses only the envelope. Payment/subscription data in the body is used as
 * a lookup hint, never as proof: the processor fetches the authoritative
 * resource from Asaas before changing any billing state.
 */
export function parseAsaasWebhook(payload: unknown): WebhookParseResult {
  const parsed = webhookSchema.safeParse(payload);

  if (!parsed.success) {
    return { ok: false, reason: "invalid_structure" };
  }

  const data = parsed.data;
  const paymentId = data.payment?.id ?? null;
  const subscriptionId = data.subscription?.id ?? data.payment?.subscription ?? null;

  if (data.event.startsWith("PAYMENT_") && !paymentId) {
    return { ok: false, reason: "invalid_structure" };
  }

  if (data.event.startsWith("SUBSCRIPTION_") && !data.subscription?.id) {
    return { ok: false, reason: "invalid_structure" };
  }

  const resourceType = paymentId ? "payment" : subscriptionId ? "subscription" : null;

  return {
    ok: true,
    event: {
      eventId: data.id,
      eventType: data.event,
      dateCreated: data.dateCreated ?? null,
      paymentId,
      subscriptionId,
      resourceType,
      resourceId: paymentId ?? subscriptionId,
      payload: payload as Record<string, unknown>,
    },
  };
}

/**
 * Official Asaas webhook authentication is the raw token sent in the
 * `asaas-access-token` header. HMAC is not part of this integration, so none
 * is invented. Both sides are hashed before the constant-time comparison so
 * length differences do not leak through timing.
 */
export function webhookTokenMatches(
  providedToken: string | null | undefined,
  expectedToken: string,
): boolean {
  return timingSafeTokenMatches(providedToken, expectedToken);
}

const PAYMENT_EVENTS = new Set([
  "PAYMENT_CREATED",
  "PAYMENT_UPDATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CHARGEBACK_DISPUTE",
  "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
  "PAYMENT_DUNNING_REQUESTED",
  "PAYMENT_DUNNING_RECEIVED",
  "PAYMENT_RESTORED",
  "PAYMENT_AWAITING_RISK_ANALYSIS",
  "PAYMENT_APPROVED_BY_RISK_ANALYSIS",
  "PAYMENT_REPROVED_BY_RISK_ANALYSIS",
]);

const SUBSCRIPTION_EVENTS = new Set([
  "SUBSCRIPTION_CREATED",
  "SUBSCRIPTION_UPDATED",
  "SUBSCRIPTION_DELETED",
]);

export function isSupportedPaymentEvent(eventType: string): boolean {
  return PAYMENT_EVENTS.has(eventType);
}

export function isSupportedSubscriptionEvent(eventType: string): boolean {
  return SUBSCRIPTION_EVENTS.has(eventType);
}

export function isSupportedEvent(eventType: string): boolean {
  return isSupportedPaymentEvent(eventType) || isSupportedSubscriptionEvent(eventType);
}
