import { timingSafeTokenMatches } from "@/lib/timing-safe";

export const BILLING_JOB_SECRET_MIN_LENGTH = 32;
export const BILLING_JOB_SECRET_MAX_LENGTH = 255;

export type BillingJobAuthorization =
  { ok: true } | { ok: false; status: 401 | 503; error: "job_not_configured" | "unauthorized" };

/**
 * Reads the dedicated job secret, falling back to the platform `CRON_SECRET`.
 * A present-but-weak dedicated secret fails closed instead of silently
 * accepting a different value.
 */
export function resolveBillingJobSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const dedicated = env.BILLING_WORKER_SECRET?.trim();
  const fallback = env.CRON_SECRET?.trim();
  const value = dedicated || fallback || "";

  if (!value) {
    return null;
  }

  if (
    value.length < BILLING_JOB_SECRET_MIN_LENGTH ||
    value.length > BILLING_JOB_SECRET_MAX_LENGTH ||
    /[\s\u0000-\u001f]/.test(value)
  ) {
    return null;
  }

  return value;
}

function readProvidedSecret(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (bearer) {
    return bearer;
  }

  return request.headers.get("x-billing-worker-secret")?.trim() ?? null;
}

export function authorizeBillingJob(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): BillingJobAuthorization {
  const expected = resolveBillingJobSecret(env);

  if (!expected) {
    return { ok: false, status: 503, error: "job_not_configured" };
  }

  if (!timingSafeTokenMatches(readProvidedSecret(request), expected)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  return { ok: true };
}
