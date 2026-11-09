import "server-only";

import type { Json } from "@/types/database";
import { BillingProcessingError, type BillingAdminClient } from "./reconcile-core";

export type BillingJobName = "webhook_processor" | "reconciliation";
export type BillingJobRunStatus = "succeeded" | "partial" | "failed";

export type BillingJobRunUpdate = {
  status: BillingJobRunStatus;
  claimed?: number;
  processed?: number;
  ignored?: number;
  retried?: number;
  deadLettered?: number;
  reconciled?: number;
  divergences?: number;
  errors: number;
  error: string | null;
  metadata?: Record<string, unknown>;
};

export type BillingJobRecorder = {
  start(jobName: BillingJobName): Promise<string | null>;
  finish(runId: string, update: BillingJobRunUpdate): Promise<void>;
};

function errorReason(error: { message: string }): string {
  return error.message.split("|")[0];
}

export function createSupabaseBillingJobRecorder(admin: BillingAdminClient): BillingJobRecorder {
  return {
    async start(jobName) {
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

    async finish(runId, update) {
      const { error } = await admin
        .from("billing_job_runs")
        .update({
          status: update.status,
          finished_at: new Date().toISOString(),
          claimed: update.claimed ?? 0,
          processed: update.processed ?? 0,
          ignored: update.ignored ?? 0,
          retried: update.retried ?? 0,
          dead_lettered: update.deadLettered ?? 0,
          reconciled: update.reconciled ?? 0,
          divergences: update.divergences ?? 0,
          errors: update.errors,
          error: update.error,
          metadata: (update.metadata ?? {}) as Json,
        })
        .eq("id", runId);

      if (error) {
        throw new BillingProcessingError(errorReason(error));
      }
    },
  };
}
