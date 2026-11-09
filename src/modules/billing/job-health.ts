import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Machine-readable health for the out-of-band billing jobs.
 *
 * `/admin/billing` answers a human with a superadmin session. An uptime monitor
 * needs the same judgement without a session, a browser or PII. This module
 * reads only counters, timestamps and the sanitized error of the last run, and
 * turns them into alert codes. It never reads payloads, documents or secrets.
 */

export const BILLING_BACKLOG_SECONDS = 5 * 60;
export const BILLING_WORKER_STALE_SECONDS = 10 * 60;
export const BILLING_RECONCILIATION_STALE_SECONDS = 2 * 60 * 60;

export type BillingAlertCode =
  | "worker_not_running"
  | "worker_last_failed"
  | "reconciliation_not_running"
  | "reconciliation_last_failed"
  | "pending_backlog"
  | "stale_processing"
  | "dead_letter";

export type BillingJobRun = {
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  claimed: number;
  processed: number;
  retried: number;
  deadLettered: number;
  reconciled: number;
  divergences: number;
  errors: number;
  error: string | null;
};

export type BillingJobSnapshot = {
  pending: number;
  oldestPendingAt: string | null;
  pendingAgeSeconds: number | null;
  staleProcessing: number;
  deadLetter: number;
  failed: number;
  lastWorkerRun: BillingJobRun | null;
  lastReconciliationRun: BillingJobRun | null;
};

export type BillingJobHealth = BillingJobSnapshot & {
  checkedAt: string;
  status: "ok" | "warning" | "critical";
  alerts: BillingAlertCode[];
};

export type BillingHealthEvaluation = {
  status: BillingJobHealth["status"];
  alerts: BillingAlertCode[];
};

function ageSeconds(iso: string | null | undefined, now: Date): number | null {
  if (!iso) {
    return null;
  }

  const parsed = Date.parse(iso);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.floor((now.getTime() - parsed) / 1000));
}

function jobRunAgeSeconds(run: BillingJobRun, now: Date): number | null {
  return ageSeconds(run.finishedAt ?? run.startedAt, now);
}

function evaluateJob(
  run: BillingJobRun | null,
  staleSeconds: number,
  notRunning: BillingAlertCode,
  lastFailed: BillingAlertCode,
  now: Date,
  alerts: BillingAlertCode[],
): void {
  if (!run) {
    alerts.push(notRunning);
    return;
  }

  const age = jobRunAgeSeconds(run, now);

  if (age === null || age > staleSeconds) {
    alerts.push(notRunning);
  }

  if (run.status === "failed") {
    alerts.push(lastFailed);
  }
}

/**
 * Pure rules so the thresholds can be tested without a database.
 *
 * `dead_letter` is a warning: it needs human review, not an outage page.
 * Everything else means the automation is not doing its job and is critical.
 */
export function evaluateBillingAlerts(
  snapshot: BillingJobSnapshot,
  now: Date = new Date(),
): BillingHealthEvaluation {
  const alerts: BillingAlertCode[] = [];
  const pendingAge =
    snapshot.pendingAgeSeconds ?? ageSeconds(snapshot.oldestPendingAt, now) ?? null;

  if (snapshot.pending > 0 && pendingAge !== null && pendingAge > BILLING_BACKLOG_SECONDS) {
    alerts.push("pending_backlog");
  }

  if (snapshot.staleProcessing > 0) {
    alerts.push("stale_processing");
  }

  if (snapshot.deadLetter > 0) {
    alerts.push("dead_letter");
  }

  evaluateJob(
    snapshot.lastWorkerRun,
    BILLING_WORKER_STALE_SECONDS,
    "worker_not_running",
    "worker_last_failed",
    now,
    alerts,
  );

  evaluateJob(
    snapshot.lastReconciliationRun,
    BILLING_RECONCILIATION_STALE_SECONDS,
    "reconciliation_not_running",
    "reconciliation_last_failed",
    now,
    alerts,
  );

  const critical = alerts.some((code) => code !== "dead_letter");

  return {
    status: critical ? "critical" : alerts.length > 0 ? "warning" : "ok",
    alerts,
  };
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message.split("|")[0];
    }
  }

  return "billing_health_unavailable";
}

export type BillingHealthClient = Pick<SupabaseClient, "from">;

async function countRows(admin: BillingHealthClient, status: string): Promise<number> {
  const { count, error } = await admin
    .from("billing_webhook_events")
    .select("id", { count: "exact", head: true })
    .eq("status", status);

  if (error) {
    throw new Error(errorMessage(error));
  }

  return count ?? 0;
}

async function countStaleProcessing(admin: BillingHealthClient, now: Date): Promise<number> {
  const { count, error } = await admin
    .from("billing_webhook_events")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing")
    .lt("lease_expires_at", now.toISOString());

  if (error) {
    throw new Error(errorMessage(error));
  }

  return count ?? 0;
}

function parseRun(data: Record<string, unknown> | null): BillingJobRun | null {
  if (!data) {
    return null;
  }

  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  const text = (value: unknown) => (typeof value === "string" ? value : null);

  return {
    status: text(data.status) ?? "unknown",
    startedAt: text(data.started_at),
    finishedAt: text(data.finished_at),
    claimed: number(data.claimed),
    processed: number(data.processed),
    retried: number(data.retried),
    deadLettered: number(data.dead_lettered),
    reconciled: number(data.reconciled),
    divergences: number(data.divergences),
    errors: number(data.errors),
    error: text(data.error),
  };
}

async function readLastRun(
  admin: BillingHealthClient,
  jobName: "webhook_processor" | "reconciliation",
): Promise<BillingJobRun | null> {
  const { data, error } = await admin
    .from("billing_job_runs")
    .select(
      "status, started_at, finished_at, claimed, processed, retried, dead_lettered, reconciled, divergences, errors, error",
    )
    .eq("job_name", jobName)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(errorMessage(error));
  }

  return parseRun((data as Record<string, unknown> | null) ?? null);
}

export async function readBillingJobSnapshot(
  admin: BillingHealthClient,
  now: Date = new Date(),
): Promise<BillingJobSnapshot> {
  const { data: oldest, error: oldestError } = await admin
    .from("billing_webhook_events")
    .select("received_at")
    .eq("status", "received")
    .order("received_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (oldestError) {
    throw new Error(errorMessage(oldestError));
  }

  const [pending, staleProcessing, deadLetter, failed, lastWorkerRun, lastReconciliationRun] =
    await Promise.all([
      countRows(admin, "received"),
      countStaleProcessing(admin, now),
      countRows(admin, "dead_letter"),
      countRows(admin, "failed"),
      readLastRun(admin, "webhook_processor"),
      readLastRun(admin, "reconciliation"),
    ]);

  const oldestPendingAt = (oldest as { received_at?: string } | null)?.received_at ?? null;

  return {
    pending,
    oldestPendingAt,
    pendingAgeSeconds: ageSeconds(oldestPendingAt, now),
    staleProcessing,
    deadLetter,
    failed,
    lastWorkerRun,
    lastReconciliationRun,
  };
}
