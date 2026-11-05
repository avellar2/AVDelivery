import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ConfigurationError } from "@/lib/errors";
import {
  AsaasConfigurationError,
  resolveAsaasConfig,
} from "@/modules/billing/providers/asaas/config";
import { AsaasClientCore } from "@/modules/billing/providers/asaas/client-core";
import { createSupabaseBillingJobRecorder } from "@/modules/billing/job-runs";
import { runBillingReconciliation } from "@/modules/billing/reconcile-runner";
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
 * Protected, rerunnable reconciliation job. It never charges, never creates a
 * subscription and never marks an invoice paid without provider confirmation.
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
  const recorder = createSupabaseBillingJobRecorder(admin);
  const result = await runBillingReconciliation(admin, client, recorder, {
    limit: envInt("BILLING_RECONCILE_LIMIT", 25),
    maxRecentPayments: envInt("BILLING_RECONCILE_MAX_PAYMENTS", 100),
    timeBudgetMs: envInt("BILLING_RECONCILE_TIME_BUDGET_MS", 45_000),
  });

  return json(result.status === "failed" ? 500 : 200, {
    ok: result.status !== "failed",
    ...result,
  });
}

export const GET = handle;
export const POST = handle;
