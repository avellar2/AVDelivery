import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ConfigurationError } from "@/lib/errors";
import {
  evaluateBillingAlerts,
  readBillingJobSnapshot,
  type BillingJobHealth,
} from "@/modules/billing/job-health";
import { authorizeBillingJob } from "@/modules/billing/worker-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Machine-readable health for the billing automation.
 *
 * Meant for an uptime monitor: answers without a browser session, returns
 * `503` when the automation is not doing its job, and never exposes payloads,
 * documents, tokens or provider keys. Protected by the same dedicated secret as
 * the worker and the reconciliation.
 */
async function handle(request: Request): Promise<Response> {
  const authorization = authorizeBillingJob(request);

  if (!authorization.ok) {
    return json(authorization.status, { ok: false, error: authorization.error });
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

  try {
    const snapshot = await readBillingJobSnapshot(admin);
    const evaluation = evaluateBillingAlerts(snapshot);
    const report: BillingJobHealth = {
      ...snapshot,
      checkedAt: new Date().toISOString(),
      status: evaluation.status,
      alerts: evaluation.alerts,
    };

    return json(evaluation.status === "critical" ? 503 : 200, {
      ok: evaluation.status !== "critical",
      ...report,
    });
  } catch {
    return json(503, { ok: false, status: "critical", alerts: ["health_unavailable"] });
  }
}

export const GET = handle;
export const POST = handle;
