import "server-only";

import { BillingProcessingError, type BillingAdminClient } from "./reconcile-core";
import type { BillingInboxEvent, BillingJobResult, BillingWorkerStore } from "./worker";
import type { Json } from "@/types/database";

function errorReason(error: { message: string }): string {
  return error.message.split("|")[0];
}

function asRecord(value: Json): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * PostgreSQL-backed adapter. All inbox state transitions live in SQL so the
 * lease invariant cannot be bypassed by application code.
 */
export function createSupabaseBillingInboxStore(admin: BillingAdminClient): BillingWorkerStore {
  return {
    async recoverStale(maxAttempts) {
      const { data, error } = await admin.rpc("billing_recover_stale_webhook_events", {
        p_max_attempts: maxAttempts,
      });

      if (error) {
        throw new BillingProcessingError(errorReason(error));
      }

      const record = asRecord(data);

      return {
        recovered: asNumber(record?.recovered),
        deadLettered: asNumber(record?.deadLettered),
      };
    },

    async claim(limit, leaseSeconds) {
      const { data, error } = await admin.rpc("billing_claim_webhook_events", {
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });

      if (error) {
        throw new BillingProcessingError(errorReason(error));
      }

      return (data ?? []).map((row): BillingInboxEvent => ({
        id: row.id,
        externalEventId: row.external_event_id,
        eventType: row.event_type,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        payload: row.payload,
        attempts: row.attempts,
        leaseToken: row.lease_token,
        receivedAt: row.received_at,
        lastAttemptAt: row.last_attempt_at,
      }));
    },

    async complete(id, leaseToken, outcome, detail) {
      const { error } = await admin.rpc("billing_complete_webhook_event", {
        p_id: id,
        p_lease_token: leaseToken,
        p_outcome: outcome,
        p_detail: detail,
      });

      if (error) {
        throw new BillingProcessingError(errorReason(error));
      }
    },

    async fail(id, leaseToken, reason, options) {
      const { data, error } = await admin.rpc("billing_fail_webhook_event", {
        p_id: id,
        p_lease_token: leaseToken,
        p_reason: reason,
        p_retryable: options.retryable,
        p_delay_seconds: options.delaySeconds,
        p_max_attempts: options.maxAttempts,
      });

      if (error) {
        throw new BillingProcessingError(errorReason(error));
      }

      const record = asRecord(data);

      return {
        status: typeof record?.status === "string" ? record.status : "failed",
        deadLettered: record?.deadLettered === true,
      };
    },

    async startJobRun(jobName) {
      const { data, error } = await admin
        .from("billing_job_runs")
        .insert({ job_name: jobName, status: "running" })
        .select("id")
        .maybeSingle();

      if (error) {
        throw new BillingProcessingError(errorReason(error));
      }

      return data?.id ?? null;
    },

    async finishJobRun(runId, result: BillingJobResult) {
      const { error } = await admin
        .from("billing_job_runs")
        .update({
          status: result.status,
          finished_at: new Date().toISOString(),
          claimed: result.claimed,
          processed: result.processed,
          ignored: result.ignored,
          retried: result.retried,
          dead_lettered: result.deadLettered,
          errors: result.errors,
          error: result.error,
        })
        .eq("id", runId);

      if (error) {
        throw new BillingProcessingError(errorReason(error));
      }
    },
  };
}
