import type { AsaasClientCore } from "./providers/asaas/client-core";
import { AsaasError } from "./providers/asaas/errors";
import { canonicalAsaasPaymentStatus, invoiceStatusForCanonical } from "./providers/asaas/money";
import type { AsaasPayment } from "./providers/asaas/types";
import type { BillingJobRecorder, BillingJobRunUpdate } from "./job-runs";
import {
  applyProviderPayment,
  BillingProcessingError,
  syncSubscriptionFromProvider,
  type BillingAdminClient,
} from "./reconcile-core";

export type ReconciliationSummary = {
  status: BillingJobRunUpdate["status"];
  candidates: number;
  subscriptionsSynced: number;
  reconciled: number;
  ignored: number;
  divergences: number;
  errors: number;
  orphanPayments: number;
  orphanPaymentIds: string[];
  error: string | null;
};

export type ReconciliationOptions = {
  limit?: number;
  maxRecentPayments?: number;
  timeBudgetMs?: number;
  now?: () => number;
};

type Divergence = { paymentId: string; reason: string };

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(value as number)));
}

function reasonOf(error: unknown): string {
  if (error instanceof AsaasError) {
    return `asaas_${error.code.toLowerCase()}`;
  }

  if (error instanceof BillingProcessingError) {
    return error.reason;
  }

  return "processing_error";
}

function expectedInvoiceStatus(payment: AsaasPayment): string | null {
  const canonical = payment.deleted
    ? ("DELETED" as const)
    : canonicalAsaasPaymentStatus(payment.status);

  return canonical ? invoiceStatusForCanonical(canonical) : null;
}

/**
 * Repeatable reconciliation driven only by the provider's authoritative data.
 *
 * - It never creates charges, never marks an invoice paid without a provider
 *   payment and never extends a period directly; every financial change goes
 *   through the same idempotent RPC used by webhooks.
 * - It recovers confirmed payments whose webhook was lost by comparing recent
 *   Asaas payments with local invoices.
 * - Subscription payments that do not exist locally are reported as orphan
 *   external charges for manual review, never silently attached to a store.
 */
export async function runBillingReconciliation(
  admin: BillingAdminClient,
  client: AsaasClientCore,
  recorder: BillingJobRecorder,
  options: ReconciliationOptions = {},
): Promise<ReconciliationSummary> {
  const now = options.now ?? Date.now;
  const deadline = now() + clamp(options.timeBudgetMs, 45_000, 5_000, 55_000);
  const limit = clamp(options.limit, 25, 1, 100);
  const maxRecentPayments = clamp(options.maxRecentPayments, 100, 1, 100);

  const summary: ReconciliationSummary = {
    status: "succeeded",
    candidates: 0,
    subscriptionsSynced: 0,
    reconciled: 0,
    ignored: 0,
    divergences: 0,
    errors: 0,
    orphanPayments: 0,
    orphanPaymentIds: [],
    error: null,
  };
  const divergenceDetails: Divergence[] = [];
  let timeBudgetExhausted = false;
  let runId: string | null = null;

  try {
    runId = await recorder.start("reconciliation");
  } catch {
    // Reconciliation still runs; the health snapshot will surface the missing
    // run record instead of treating the financial work as impossible.
  }

  const candidates = await admin.rpc("billing_reconciliation_candidates", { p_limit: limit });

  if (candidates.error) {
    summary.status = "failed";
    summary.errors = 1;
    summary.error = "candidates_failed";
    await finish(recorder, runId, summary, divergenceDetails, {});
    return summary;
  }

  const rows = candidates.data ?? [];
  summary.candidates = rows.length;

  for (const row of rows) {
    if (now() >= deadline) {
      timeBudgetExhausted = true;
      break;
    }

    try {
      const subscription = await client.getSubscription(row.external_subscription_id);
      const sync = await syncSubscriptionFromProvider(admin, client, subscription, {
        eventType: "RECONCILIATION",
      });

      summary.subscriptionsSynced += 1;
      summary.reconciled += sync.applied;
      summary.ignored += sync.ignored;

      if (sync.failures.length > 0) {
        summary.divergences += sync.failures.length;
        divergenceDetails.push(...sync.failures.slice(0, 25));
      }
    } catch (error) {
      if (error instanceof AsaasError && error.code === "NOT_FOUND") {
        summary.divergences += 1;
        divergenceDetails.push({
          paymentId: row.external_subscription_id,
          reason: "external_subscription_not_found",
        });
        continue;
      }

      summary.errors += 1;
      summary.error = reasonOf(error);
    }
  }

  if (now() < deadline) {
    await scanRecentPayments(admin, client, summary, divergenceDetails, maxRecentPayments);
  }

  if (summary.errors > 0) {
    summary.status =
      summary.reconciled > 0 || summary.subscriptionsSynced > 0 ? "partial" : "failed";
  } else if (summary.divergences > 0 || timeBudgetExhausted) {
    summary.status = "partial";
  }

  await finish(recorder, runId, summary, divergenceDetails, {
    timeBudgetExhausted,
  });

  return summary;
}

async function scanRecentPayments(
  admin: BillingAdminClient,
  client: AsaasClientCore,
  summary: ReconciliationSummary,
  divergenceDetails: Divergence[],
  limit: number,
): Promise<void> {
  let payments: AsaasPayment[];

  try {
    payments = await client.listRecentPayments({ limit });
  } catch (error) {
    summary.errors += 1;
    summary.error = reasonOf(error);
    return;
  }

  const subscriptionPayments = payments.filter((payment) => Boolean(payment.subscription));
  const externalIds = [
    ...new Set(
      subscriptionPayments
        .map((payment) => payment.subscription)
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  if (externalIds.length === 0) {
    return;
  }

  const localSubscriptions = await admin
    .from("subscriptions")
    .select("external_subscription_id")
    .in("external_subscription_id", externalIds);

  if (localSubscriptions.error) {
    summary.errors += 1;
    summary.error = "subscription_lookup_failed";
    return;
  }

  const knownIds = new Set(
    (localSubscriptions.data ?? [])
      .map((row) => row.external_subscription_id)
      .filter((value): value is string => Boolean(value)),
  );

  const orphanIds = externalIds.filter((id) => !knownIds.has(id));
  summary.orphanPayments = orphanIds.length;
  summary.orphanPaymentIds = orphanIds.slice(0, 25);

  const knownPayments = subscriptionPayments.filter(
    (payment) => payment.subscription && knownIds.has(payment.subscription),
  );

  if (knownPayments.length === 0) {
    return;
  }

  const paymentIds = knownPayments.map((payment) => payment.id);
  const localInvoices = await admin
    .from("invoices")
    .select("external_payment_id, status")
    .in("external_payment_id", paymentIds);

  if (localInvoices.error) {
    summary.errors += 1;
    summary.error = "invoice_lookup_failed";
    return;
  }

  const localByPaymentId = new Map<string, string>();

  for (const row of localInvoices.data ?? []) {
    if (row.external_payment_id) {
      localByPaymentId.set(row.external_payment_id, row.status);
    }
  }

  for (const payment of knownPayments) {
    const expected = expectedInvoiceStatus(payment);

    if (!expected) {
      summary.ignored += 1;
      continue;
    }

    if (localByPaymentId.get(payment.id) === expected) {
      continue;
    }

    try {
      const applied = await applyProviderPayment(admin, payment, {
        eventId: null,
        eventType: "RECONCILIATION_SCAN",
        payload: { source: "reconciliation_scan", paymentId: payment.id },
      });

      if (applied.applied) {
        summary.reconciled += 1;
      } else {
        summary.ignored += 1;
      }
    } catch (error) {
      if (error instanceof BillingProcessingError && error.reason === "amount_mismatch") {
        summary.divergences += 1;
        divergenceDetails.push({ paymentId: payment.id, reason: error.reason });
        continue;
      }

      summary.errors += 1;
      summary.error = reasonOf(error);
    }
  }
}

async function finish(
  recorder: BillingJobRecorder,
  runId: string | null,
  summary: ReconciliationSummary,
  divergences: Divergence[],
  extraMetadata: Record<string, unknown>,
): Promise<void> {
  if (!runId) {
    return;
  }

  try {
    await recorder.finish(runId, {
      status: summary.status,
      reconciled: summary.reconciled,
      divergences: summary.divergences,
      errors: summary.errors,
      error: summary.error,
      metadata: {
        candidates: summary.candidates,
        subscriptionsSynced: summary.subscriptionsSynced,
        ignored: summary.ignored,
        orphanPayments: summary.orphanPayments,
        orphanPaymentIds: summary.orphanPaymentIds,
        divergenceSample: divergences.slice(0, 25),
        ...extraMetadata,
      },
    });
  } catch {
    // The financial result stands; the missing run record is visible through
    // the "reconciliation_not_running" alert.
  }
}
