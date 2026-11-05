import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ConfigurationError } from "@/lib/errors";
import {
  AsaasConfigurationError,
  resolveAsaasConfig,
} from "@/modules/billing/providers/asaas/config";
import { AsaasClientCore } from "@/modules/billing/providers/asaas/client-core";
import { createSupabaseBillingInboxStore } from "@/modules/billing/inbox-store";
import { processAsaasWebhookEvent } from "@/modules/billing/reconcile-core";
import { runBillingWorker } from "@/modules/billing/worker";
import { authorizeBillingJob } from "@/modules/billing/worker-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();

  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Protected out-of-band processor for the durable Asaas inbox.
 *
 * This endpoint is the only place that applies webhook events. It is designed
 * to be called by an external scheduler (Vercel Cron, Supabase Cron/pg_net or
 * any cron runner) and is safe to call concurrently: claiming is atomic.
 * It must never be exposed to the browser; the secret is the boundary.
 */
async function handle(request: Request): Promise<Response> {
  const authorization = authorizeBillingJob(request);

  if (!authorization.ok) {
    return json(authorization.status, { ok: false, error: authorization.error });
  }

  let config;

  try {
    config = resolveAsaasConfig();
  } catch (error) {
    const reason =
      error instanceof AsaasConfigurationError ? "invalid_provider_config" : "config_error";
    return json(503, { ok: false, error: reason });
  }

  if (!config) {
    return json(503, { ok: false, error: "provider_not_configured" });
  }

  let admin;

  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    return json(503, {
      ok: false,
      error: error instanceof ConfigurationError ? "configuration_error" : "admin_client_error",
    });
  }

  const client = new AsaasClientCore(config);
  const store = createSupabaseBillingInboxStore(admin);
  const result = await runBillingWorker(
    {
      store,
      processEvent: (event) => processAsaasWebhookEvent(admin, client, event),
    },
    {
      batchSize: envInt("BILLING_WORKER_BATCH_SIZE", 10),
      maxEvents: envInt("BILLING_WORKER_MAX_EVENTS", 25),
      leaseSeconds: envInt("BILLING_WORKER_LEASE_SECONDS", 120),
      maxAttempts: envInt("BILLING_WORKER_MAX_ATTEMPTS", 8),
      timeBudgetMs: envInt("BILLING_WORKER_TIME_BUDGET_MS", 45_000),
    },
  );

  return json(result.status === "failed" ? 500 : 200, {
    ok: result.status !== "failed",
    ...result,
  });
}

export const GET = handle;
export const POST = handle;
