import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { reportServerError } from "@/lib/errors";
import {
  AsaasConfigurationError,
  createAsaasClient,
} from "@/modules/billing/providers/asaas/client";
import {
  resolveAsaasConfig,
  resolveAsaasWebhookToken,
} from "@/modules/billing/providers/asaas/config";
import { processAsaasWebhookEvent } from "@/modules/billing/reconcile-core";
import {
  ASAAS_WEBHOOK_MAX_BYTES,
  isSupportedEvent,
  parseAsaasWebhook,
  webhookTokenMatches,
} from "@/modules/billing/providers/asaas/webhook";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PAYLOAD_BYTES = ASAAS_WEBHOOK_MAX_BYTES;

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function safeError(error: unknown): string {
  if (error instanceof AsaasConfigurationError) {
    return "configuration_error";
  }

  const message = error instanceof Error ? error.message : "processing_error";
  return message.split("|")[0].slice(0, 500);
}

/**
 * Durable Asaas webhook endpoint.
 *
 * - Official authentication: `asaas-access-token` compared in constant time.
 * - No HMAC is invented; Asaas does not sign payloads with one here.
 * - The payload is persisted before processing and never trusted as proof of
 *   payment: the processor fetches the payment from Asaas first.
 * - Store association comes only from known external ids, never from a body
 *   field such as store_id.
 * - Duplicate deliveries are short-circuited by the unique event id.
 */
export async function POST(request: Request): Promise<Response> {
  let expectedToken: string | null;

  try {
    expectedToken = resolveAsaasWebhookToken();
  } catch {
    return json(503, { received: false, error: "webhook_not_configured" });
  }

  if (!expectedToken) {
    return json(503, { received: false, error: "webhook_not_configured" });
  }

  if (!webhookTokenMatches(request.headers.get("asaas-access-token"), expectedToken)) {
    return json(401, { received: false, error: "invalid_token" });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");

  if (Number.isFinite(contentLength) && contentLength > MAX_PAYLOAD_BYTES) {
    return json(413, { received: false, error: "payload_too_large" });
  }

  const raw = await request.text();

  if (Buffer.byteLength(raw, "utf8") > MAX_PAYLOAD_BYTES) {
    return json(413, { received: false, error: "payload_too_large" });
  }

  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400, { received: false, error: "invalid_json" });
  }

  const parsed = parseAsaasWebhook(payload);

  if (!parsed.ok) {
    return json(400, { received: false, error: "invalid_structure" });
  }

  const event = parsed.event;

  let providerConfigured = false;

  try {
    providerConfigured = resolveAsaasConfig() !== null;
  } catch {
    providerConfigured = false;
  }

  if (!providerConfigured) {
    return json(503, { received: false, error: "provider_not_configured" });
  }

  const admin = createSupabaseAdminClient();

  const inserted = await admin
    .from("billing_webhook_events")
    .insert({
      provider: "asaas",
      external_event_id: event.eventId,
      event_type: event.eventType,
      resource_type: event.resourceType,
      resource_id: event.resourceId,
      payload: event.payload as Json,
      status: "received",
    })
    .select("id, status, attempts")
    .maybeSingle();

  if (inserted.error && inserted.error.code !== "23505") {
    reportServerError("billing.webhook.persist", inserted.error);
    return json(500, { received: false, error: "persistence_failed" });
  }

  let inbox = inserted.data;

  if (!inbox) {
    const existing = await admin
      .from("billing_webhook_events")
      .select("id, status, attempts")
      .eq("provider", "asaas")
      .eq("external_event_id", event.eventId)
      .maybeSingle();

    if (existing.error || !existing.data) {
      reportServerError("billing.webhook.duplicate", existing.error);
      return json(500, { received: false, error: "persistence_failed" });
    }

    inbox = existing.data;
  }

  if (inbox.status === "processed" || inbox.status === "ignored") {
    return json(200, { received: true, duplicate: true, status: inbox.status });
  }

  const claimed = await admin
    .from("billing_webhook_events")
    .update({ status: "processing", attempts: inbox.attempts + 1 })
    .eq("id", inbox.id)
    .in("status", ["received", "failed"])
    .select("id")
    .maybeSingle();

  if (claimed.error) {
    reportServerError("billing.webhook.claim", claimed.error);
    return json(500, { received: false, error: "processing_failed" });
  }

  if (!claimed.data) {
    const current = await admin
      .from("billing_webhook_events")
      .select("status")
      .eq("id", inbox.id)
      .maybeSingle();

    if (current.data?.status === "processed" || current.data?.status === "ignored") {
      return json(200, { received: true, duplicate: true, status: current.data.status });
    }

    // Another delivery is already processing this event. Acknowledge so Asaas
    // does not hammer the endpoint; the durable inbox keeps the record.
    return json(202, { received: true, status: "processing" });
  }

  if (!isSupportedEvent(event.eventType)) {
    await admin
      .from("billing_webhook_events")
      .update({
        status: "ignored",
        last_error: "unsupported_event",
        processed_at: new Date().toISOString(),
      })
      .eq("id", inbox.id);

    return json(200, { received: true, status: "ignored" });
  }

  try {
    const client = createAsaasClient();
    const result = await processAsaasWebhookEvent(admin, client, event);

    await admin
      .from("billing_webhook_events")
      .update({
        status: result.outcome,
        last_error: result.outcome === "ignored" ? result.detail.slice(0, 1000) : null,
        processed_at: new Date().toISOString(),
      })
      .eq("id", inbox.id);

    return json(200, { received: true, status: result.outcome });
  } catch (error) {
    const reason = safeError(error);
    reportServerError("billing.webhook.process", error);

    await admin
      .from("billing_webhook_events")
      .update({
        status: "failed",
        last_error: reason.slice(0, 1000),
        processed_at: null,
      })
      .eq("id", inbox.id);

    // Non-2xx makes Asaas redeliver the same event id. The inbox row remains
    // failed and can also be retried by the reconciliation command.
    return json(500, { received: false, error: "processing_failed" });
  }
}
