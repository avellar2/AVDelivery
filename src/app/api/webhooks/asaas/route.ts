import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ConfigurationError, reportServerError } from "@/lib/errors";
import { resolveAsaasWebhookToken } from "@/modules/billing/providers/asaas/config";
import {
  ASAAS_WEBHOOK_MAX_BYTES,
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

/**
 * Durable Asaas webhook receipt endpoint.
 *
 * Contract:
 * - authenticate first, always in constant time;
 * - validate the envelope;
 * - persist the event durably in `billing_webhook_events`;
 * - return HTTP 200 only after persistence is confirmed;
 * - never run financial processing inside the HTTP request.
 *
 * Asaas considers only HTTP 200 a successful delivery. HTTP 202 is never used
 * as an acknowledgement. A persistence failure returns 500 so Asaas retries.
 * The payload is never trusted as proof of payment: the out-of-band processor
 * fetches the authoritative resource from Asaas first.
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

  let admin;

  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    reportServerError("billing.webhook.admin", error);
    return json(503, {
      received: false,
      error: error instanceof ConfigurationError ? "configuration_error" : "persistence_failed",
    });
  }

  const received = await admin.rpc("billing_receive_webhook_event", {
    p_provider: "asaas",
    p_external_event_id: event.eventId,
    p_event_type: event.eventType,
    p_resource_type: event.resourceType ?? "",
    p_resource_id: event.resourceId ?? "",
    p_payload: event.payload as Json,
  });

  if (received.error) {
    reportServerError("billing.webhook.persist", received.error);
    return json(500, { received: false, error: "persistence_failed" });
  }

  const record =
    received.data && typeof received.data === "object" && !Array.isArray(received.data)
      ? (received.data as Record<string, unknown>)
      : {};

  return json(200, {
    received: true,
    duplicate: record.duplicate === true,
    status: typeof record.status === "string" ? record.status : "received",
  });
}
