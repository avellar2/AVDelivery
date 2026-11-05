import { AsaasError } from "./providers/asaas/errors";
import type { AsaasWebhookEvent } from "./providers/asaas/webhook";
import { BillingProcessingError, type WebhookProcessResult } from "./reconcile-core";
import type { Json } from "@/types/database";

export type BillingInboxEvent = {
  id: string;
  externalEventId: string;
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
  payload: Json;
  attempts: number;
  leaseToken: string;
  receivedAt: string;
  lastAttemptAt: string | null;
};

export type BillingEventProcessor = (event: AsaasWebhookEvent) => Promise<WebhookProcessResult>;

export type BillingJobStatus = "succeeded" | "partial" | "failed";

export type BillingJobResult = {
  status: BillingJobStatus;
  claimed: number;
  processed: number;
  ignored: number;
  retried: number;
  deadLettered: number;
  errors: number;
  error: string | null;
};

export type BillingWorkerStore = {
  recoverStale(maxAttempts: number): Promise<{ recovered: number; deadLettered: number }>;
  claim(limit: number, leaseSeconds: number): Promise<BillingInboxEvent[]>;
  complete(
    id: string,
    leaseToken: string,
    outcome: "processed" | "ignored",
    detail: string | null,
  ): Promise<void>;
  fail(
    id: string,
    leaseToken: string,
    reason: string,
    options: { retryable: boolean; delaySeconds: number; maxAttempts: number },
  ): Promise<{ status: string; deadLettered: boolean }>;
  startJobRun(jobName: "webhook_processor"): Promise<string | null>;
  finishJobRun(runId: string, result: BillingJobResult): Promise<void>;
};

export type BillingRetryKind = "resource" | "provider" | "transient";

export type BillingFailureDecision = {
  retryable: boolean;
  kind: BillingRetryKind;
  reason: string;
};

/**
 * Local financial divergences must not be retried as if they were transport
 * errors: retrying cannot fix an amount/currency mismatch and would only delay
 * a human decision. Unknown database errors default to retryable.
 */
const PERMANENT_REASONS = new Set([
  "invalid_provider",
  "invalid_payment_id",
  "invalid_provider_amount",
  "external_subscription_missing",
  "external_customer_missing",
  "external_customer_mismatch",
  "currency_mismatch",
  "amount_mismatch",
  "invalid_due_date",
  "invalid_payment_status",
]);

const RESOURCE_REASONS = new Set(["external_subscription_unknown"]);

const RETRYABLE_IGNORED = new Set([
  "provider_payment_not_found",
  "provider_subscription_not_found",
]);

const DEAD_LETTER_IGNORED = new Set([
  "manual_review_partial_refund",
  "provider_payment_mismatch",
  "unsupported_payment_status",
]);

export function classifyBillingFailure(error: unknown): BillingFailureDecision {
  if (error instanceof AsaasError) {
    switch (error.code) {
      case "NOT_FOUND":
        return { retryable: true, kind: "resource", reason: "asaas_not_found" };
      case "NETWORK":
      case "TIMEOUT":
      case "RATE_LIMIT":
      case "SERVER":
      case "INVALID_RESPONSE":
        return {
          retryable: true,
          kind: "provider",
          reason: `asaas_${error.code.toLowerCase()}`,
        };
      case "AUTH":
      case "VALIDATION":
      case "CONFIGURATION":
      default:
        return {
          retryable: false,
          kind: "provider",
          reason: `asaas_${error.code.toLowerCase()}`,
        };
    }
  }

  if (error instanceof BillingProcessingError) {
    if (RESOURCE_REASONS.has(error.reason)) {
      return { retryable: true, kind: "resource", reason: error.reason };
    }

    if (PERMANENT_REASONS.has(error.reason)) {
      return { retryable: false, kind: "transient", reason: error.reason };
    }

    return { retryable: true, kind: "transient", reason: error.reason };
  }

  return { retryable: true, kind: "transient", reason: "processing_error" };
}

const RETRY_BASE_SECONDS: Record<BillingRetryKind, number> = {
  resource: 15,
  provider: 20,
  transient: 30,
};

const RETRY_CAP_SECONDS: Record<BillingRetryKind, number> = {
  resource: 900,
  provider: 600,
  transient: 900,
};

/**
 * Exponential backoff with jitter. `attempt` is the attempt number already
 * recorded by the atomic claim (1 on the first try).
 */
export function billingRetryDelaySeconds(
  attempt: number,
  kind: BillingRetryKind,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, Math.min(10, Math.trunc(attempt) - 1));
  const raw = Math.min(RETRY_CAP_SECONDS[kind], RETRY_BASE_SECONDS[kind] * 2 ** exponent);
  const jitter = 0.75 + Math.min(1, Math.max(0, random())) * 0.5;

  return Math.max(5, Math.min(RETRY_CAP_SECONDS[kind], Math.round(raw * jitter)));
}

function asRecord(value: Json): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function inboxEventToWebhookEvent(event: BillingInboxEvent): AsaasWebhookEvent {
  const payload = asRecord(event.payload) ?? {};
  const payment = asRecord((payload.payment as Json | undefined) ?? null);
  const resourceType =
    event.resourceType === "payment" || event.resourceType === "subscription"
      ? event.resourceType
      : null;
  const subscriptionId =
    resourceType === "subscription"
      ? event.resourceId
      : typeof payment?.subscription === "string"
        ? payment.subscription
        : null;

  return {
    eventId: event.externalEventId,
    eventType: event.eventType,
    dateCreated: typeof payload.dateCreated === "string" ? payload.dateCreated : null,
    paymentId: resourceType === "payment" ? event.resourceId : null,
    subscriptionId,
    resourceType,
    resourceId: event.resourceId,
    payload,
  };
}

type EventOutcome = "processed" | "ignored" | "retried" | "dead_letter" | "error";

function defaultLogger(entry: Record<string, unknown>): void {
  console.info(`[billing.worker] ${JSON.stringify(entry)}`);
}

export type BillingWorkerDeps = {
  store: BillingWorkerStore;
  processEvent: BillingEventProcessor;
  now?: () => number;
  random?: () => number;
  logger?: (entry: Record<string, unknown>) => void;
};

export type BillingWorkerOptions = {
  batchSize?: number;
  maxEvents?: number;
  leaseSeconds?: number;
  maxAttempts?: number;
  timeBudgetMs?: number;
};

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(value as number)));
}

/**
 * Out-of-band processor over the durable inbox. It never receives payloads
 * from HTTP and never relies on in-process memory: every unit of work is
 * claimed from PostgreSQL under a lease, so two concurrent runs cannot apply
 * the same event and a crash only delays it until the lease expires.
 */
export async function runBillingWorker(
  deps: BillingWorkerDeps,
  options: BillingWorkerOptions = {},
): Promise<BillingJobResult> {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const log = deps.logger ?? defaultLogger;
  const batchSize = clamp(options.batchSize, 10, 1, 50);
  const maxEvents = clamp(options.maxEvents, 25, 1, 100);
  const leaseSeconds = clamp(options.leaseSeconds, 120, 30, 900);
  const maxAttempts = clamp(options.maxAttempts, 8, 1, 50);
  const deadline = now() + clamp(options.timeBudgetMs, 45_000, 5_000, 55_000);

  const result: BillingJobResult = {
    status: "succeeded",
    claimed: 0,
    processed: 0,
    ignored: 0,
    retried: 0,
    deadLettered: 0,
    errors: 0,
    error: null,
  };

  let runId: string | null = null;

  try {
    runId = await deps.store.startJobRun("webhook_processor");
  } catch (error) {
    log({ event: "job_run_start_failed", reason: classifyBillingFailure(error).reason });
  }

  try {
    const recovery = await deps.store.recoverStale(maxAttempts);
    result.retried += recovery.recovered;
    result.deadLettered += recovery.deadLettered;

    if (recovery.recovered > 0 || recovery.deadLettered > 0) {
      log({
        event: "stale_leases_recovered",
        recovered: recovery.recovered,
        deadLettered: recovery.deadLettered,
      });
    }
  } catch (error) {
    result.status = "failed";
    result.errors += 1;
    result.error = `recovery_failed:${classifyBillingFailure(error).reason}`;
    log({ event: "recovery_failed", reason: classifyBillingFailure(error).reason });
    await finishRun(deps, runId, result, log);
    return result;
  }

  while (now() < deadline && result.claimed < maxEvents) {
    let events: BillingInboxEvent[];

    try {
      events = await deps.store.claim(
        Math.min(batchSize, maxEvents - result.claimed),
        leaseSeconds,
      );
    } catch (error) {
      result.status = "failed";
      result.errors += 1;
      result.error = `claim_failed:${classifyBillingFailure(error).reason}`;
      log({ event: "claim_failed", reason: classifyBillingFailure(error).reason });
      break;
    }

    if (events.length === 0) {
      break;
    }

    result.claimed += events.length;

    for (const event of events) {
      if (now() >= deadline) {
        // The unclaimed lease expires naturally; the next run recovers it.
        log({ event: "time_budget_exhausted", eventId: event.id });
        break;
      }

      const outcome = await processOne(event, deps, { maxAttempts, random, log });
      result[outcomeKey(outcome)] += 1;

      if (outcome === "error") {
        result.status = result.status === "failed" ? "failed" : "partial";
      }
    }
  }

  if (result.deadLettered > 0 && result.status === "succeeded") {
    // Dead letters are terminal outcomes, not a crash: the run itself remains
    // successful, but the admin health snapshot raises a dedicated alert.
    log({ event: "run_completed_with_dead_letters", deadLettered: result.deadLettered });
  }

  await finishRun(deps, runId, result, log);
  return result;
}

function outcomeKey(
  outcome: EventOutcome,
): keyof Pick<BillingJobResult, "processed" | "ignored" | "retried" | "deadLettered" | "errors"> {
  switch (outcome) {
    case "processed":
      return "processed";
    case "ignored":
      return "ignored";
    case "retried":
      return "retried";
    case "dead_letter":
      return "deadLettered";
    case "error":
      return "errors";
  }
}

async function processOne(
  event: BillingInboxEvent,
  deps: BillingWorkerDeps,
  context: {
    maxAttempts: number;
    random: () => number;
    log: (entry: Record<string, unknown>) => void;
  },
): Promise<EventOutcome> {
  const baseLog = {
    eventId: event.id,
    eventType: event.eventType,
    resourceType: event.resourceType,
    attempt: event.attempts,
  };

  try {
    const result = await deps.processEvent(inboxEventToWebhookEvent(event));

    if (result.outcome === "processed") {
      await deps.store.complete(event.id, event.leaseToken, "processed", null);
      context.log({ ...baseLog, outcome: "processed", detail: result.detail });
      return "processed";
    }

    if (RETRYABLE_IGNORED.has(result.detail)) {
      await deps.store.fail(event.id, event.leaseToken, result.detail, {
        retryable: true,
        delaySeconds: billingRetryDelaySeconds(event.attempts, "resource", context.random),
        maxAttempts: context.maxAttempts,
      });
      context.log({ ...baseLog, outcome: "retried", detail: result.detail });
      return event.attempts >= context.maxAttempts ? "dead_letter" : "retried";
    }

    if (DEAD_LETTER_IGNORED.has(result.detail)) {
      await deps.store.fail(event.id, event.leaseToken, result.detail, {
        retryable: false,
        delaySeconds: 0,
        maxAttempts: context.maxAttempts,
      });
      context.log({ ...baseLog, outcome: "dead_letter", detail: result.detail });
      return "dead_letter";
    }

    await deps.store.complete(event.id, event.leaseToken, "ignored", result.detail);
    context.log({ ...baseLog, outcome: "ignored", detail: result.detail });
    return "ignored";
  } catch (error) {
    const failure = classifyBillingFailure(error);
    const exhausted = event.attempts >= context.maxAttempts;
    const reason = exhausted ? `attempts_exhausted:${failure.reason}` : failure.reason;

    try {
      await deps.store.fail(event.id, event.leaseToken, reason, {
        retryable: failure.retryable && !exhausted,
        delaySeconds:
          failure.retryable && !exhausted
            ? billingRetryDelaySeconds(event.attempts, failure.kind, context.random)
            : 0,
        maxAttempts: context.maxAttempts,
      });
    } catch (persistError) {
      // The database is also the retry mechanism: if recording the failure
      // fails, the lease expires and the event is recovered later.
      context.log({
        ...baseLog,
        outcome: "error",
        reason: "failure_not_recorded",
        failureReason: classifyBillingFailure(persistError).reason,
      });
      return "error";
    }

    if (!failure.retryable || exhausted) {
      context.log({ ...baseLog, outcome: "dead_letter", detail: reason });
      return "dead_letter";
    }

    context.log({ ...baseLog, outcome: "retried", detail: reason });
    return "retried";
  }
}

async function finishRun(
  deps: BillingWorkerDeps,
  runId: string | null,
  result: BillingJobResult,
  log: (entry: Record<string, unknown>) => void,
): Promise<void> {
  if (!runId) {
    return;
  }

  try {
    await deps.store.finishJobRun(runId, result);
  } catch (error) {
    log({ event: "job_run_finish_failed", reason: classifyBillingFailure(error).reason });
  }
}
