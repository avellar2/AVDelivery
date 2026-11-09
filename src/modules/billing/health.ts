import "server-only";

import { BillingProcessingError } from "./reconcile-core";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export type BillingHealthRun = {
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  claimed: number;
  processed: number;
  ignored: number;
  retried: number;
  deadLettered: number;
  reconciled: number;
  divergences: number;
  errors: number;
  error: string | null;
  metadata: Record<string, unknown> | null;
};

export type BillingHealth = {
  generatedAt: string | null;
  statusCounts: Record<string, number>;
  pending: number;
  oldestPendingAt: string | null;
  pendingAgeSeconds: number | null;
  staleProcessing: number;
  deadLetter: number;
  failed: number;
  lastProcessedAt: string | null;
  lastWorkerRun: BillingHealthRun | null;
  lastReconciliationRun: BillingHealthRun | null;
  alerts: string[];
};

function parseRun(value: unknown): BillingHealthRun | null {
  const record = asRecord(value);

  if (!record) {
    return null;
  }

  return {
    status: asString(record.status) ?? "unknown",
    startedAt: asString(record.startedAt),
    finishedAt: asString(record.finishedAt),
    claimed: asNumber(record.claimed),
    processed: asNumber(record.processed),
    ignored: asNumber(record.ignored),
    retried: asNumber(record.retried),
    deadLettered: asNumber(record.deadLettered),
    reconciled: asNumber(record.reconciled),
    divergences: asNumber(record.divergences),
    errors: asNumber(record.errors),
    error: asString(record.error),
    metadata: asRecord(record.metadata),
  };
}

/**
 * Superadmin-only snapshot. The SQL function repeats the platform-admin check
 * so a direct RPC call cannot bypass the route guard. No payload, document,
 * token or provider key is read.
 */
export async function getBillingHealth(): Promise<BillingHealth> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_get_billing_health");

  if (error) {
    throw new BillingProcessingError(error.message.split("|")[0]);
  }

  const record = asRecord(data);
  const countsRecord = asRecord(record?.statusCounts) ?? {};
  const statusCounts: Record<string, number> = {};

  for (const [key, value] of Object.entries(countsRecord)) {
    statusCounts[key] = asNumber(value);
  }

  return {
    generatedAt: asString(record?.generatedAt),
    statusCounts,
    pending: asNumber(record?.pending),
    oldestPendingAt: asString(record?.oldestPendingAt),
    pendingAgeSeconds: asNullableNumber(record?.pendingAgeSeconds),
    staleProcessing: asNumber(record?.staleProcessing),
    deadLetter: asNumber(record?.deadLetter),
    failed: asNumber(record?.failed),
    lastProcessedAt: asString(record?.lastProcessedAt),
    lastWorkerRun: parseRun(record?.lastWorkerRun),
    lastReconciliationRun: parseRun(record?.lastReconciliationRun),
    alerts: asStringArray(record?.alerts),
  };
}
