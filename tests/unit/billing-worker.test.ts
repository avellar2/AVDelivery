import { describe, expect, it, vi } from "vitest";

import { AsaasError } from "@/modules/billing/providers/asaas/errors";
import { BillingProcessingError } from "@/modules/billing/reconcile-core";
import {
  billingRetryDelaySeconds,
  classifyBillingFailure,
  inboxEventToWebhookEvent,
  runBillingWorker,
  type BillingInboxEvent,
  type BillingWorkerStore,
} from "@/modules/billing/worker";

function createEvent(overrides: Partial<BillingInboxEvent> = {}): BillingInboxEvent {
  return {
    id: "row-1",
    externalEventId: "evt_1",
    eventType: "PAYMENT_CONFIRMED",
    resourceType: "payment",
    resourceId: "pay_1",
    payload: { payment: { subscription: "sub_1" } },
    attempts: 1,
    leaseToken: "lease-1",
    receivedAt: "2026-11-05T12:00:00.000Z",
    lastAttemptAt: null,
    ...overrides,
  };
}

function createStore(overrides: Partial<BillingWorkerStore> = {}): BillingWorkerStore {
  return {
    recoverStale: vi.fn(async () => ({ recovered: 0, deadLettered: 0 })),
    claim: vi.fn(async () => [] as BillingInboxEvent[]),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => ({ status: "failed", deadLettered: false })),
    startJobRun: vi.fn(async () => "run-1"),
    finishJobRun: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("classificação de falhas do processador", () => {
  it("trata erros transitórios do Asaas como retry", () => {
    for (const code of [
      "TIMEOUT",
      "NETWORK",
      "RATE_LIMIT",
      "SERVER",
      "INVALID_RESPONSE",
    ] as const) {
      const decision = classifyBillingFailure(new AsaasError(code, "falha segura"));
      expect(decision.retryable).toBe(true);
      expect(decision.kind).toBe("provider");
    }
  });

  it("não repete erro permanente de configuração ou validação", () => {
    for (const code of ["AUTH", "VALIDATION", "CONFIGURATION"] as const) {
      const decision = classifyBillingFailure(new AsaasError(code, "falha segura"));
      expect(decision.retryable).toBe(false);
    }
  });

  it("repete recurso que ainda não foi persistido", () => {
    const decision = classifyBillingFailure(
      new BillingProcessingError("external_subscription_unknown"),
    );
    expect(decision).toMatchObject({ retryable: true, kind: "resource" });
  });

  it("não repete divergência financeira", () => {
    for (const reason of [
      "amount_mismatch",
      "currency_mismatch",
      "external_customer_mismatch",
      "invalid_payment_status",
    ]) {
      const decision = classifyBillingFailure(new BillingProcessingError(reason));
      expect(decision.retryable).toBe(false);
      expect(decision.reason).toBe(reason);
    }
  });

  it("trata erro desconhecido como transitório", () => {
    expect(classifyBillingFailure(new Error("fetch failed"))).toMatchObject({
      retryable: true,
      kind: "transient",
    });
  });
});

describe("backoff do processador", () => {
  it("cresce exponencialmente e respeita o teto", () => {
    expect(billingRetryDelaySeconds(1, "resource", () => 0.5)).toBe(15);
    expect(billingRetryDelaySeconds(3, "resource", () => 0.5)).toBe(60);
    expect(billingRetryDelaySeconds(20, "resource", () => 1)).toBe(900);
    expect(billingRetryDelaySeconds(20, "provider", () => 1)).toBe(600);
  });

  it("aplica jitter dentro da faixa e nunca retorna menos de 5 segundos", () => {
    for (const random of [0, 0.25, 0.5, 0.75, 1]) {
      const delay = billingRetryDelaySeconds(2, "transient", () => random);
      expect(delay).toBeGreaterThanOrEqual(5);
      expect(delay).toBeLessThanOrEqual(900);
    }
  });
});

describe("mapeamento da inbox", () => {
  it("reconstrói o evento sem confiar em campos novos do payload", () => {
    const event = inboxEventToWebhookEvent(
      createEvent({
        payload: {
          id: "evt_1",
          dateCreated: "2026-11-05",
          payment: { id: "pay_1", subscription: "sub_1", status: "CONFIRMED" },
        },
      }),
    );

    expect(event).toMatchObject({
      eventId: "evt_1",
      eventType: "PAYMENT_CONFIRMED",
      paymentId: "pay_1",
      subscriptionId: "sub_1",
      resourceType: "payment",
    });
  });

  it("produz evento sem recurso para eventos desconhecidos", () => {
    const event = inboxEventToWebhookEvent(
      createEvent({ resourceType: null, resourceId: null, eventType: "TRANSFER_CREATED" }),
    );

    expect(event.resourceType).toBeNull();
    expect(event.paymentId).toBeNull();
  });
});

describe("execução do processador", () => {
  it("processa um evento reivindicado e registra o job run", async () => {
    const store = createStore({
      claim: vi.fn(async () => [createEvent()]),
    });
    const processEvent = vi.fn(async () => ({
      outcome: "processed" as const,
      detail: "payment_confirmed",
      storeId: "store-1",
    }));

    const result = await runBillingWorker(
      { store, processEvent, random: () => 0.5, logger: vi.fn() },
      { maxEvents: 1 },
    );

    expect(result).toMatchObject({
      status: "succeeded",
      claimed: 1,
      processed: 1,
      ignored: 0,
      retried: 0,
      deadLettered: 0,
    });
    expect(store.complete).toHaveBeenCalledWith("row-1", "lease-1", "processed", null);
    expect(store.finishJobRun).toHaveBeenCalledWith("run-1", expect.objectContaining(result));
  });

  it("reagenda pagamento ainda não visível no provedor", async () => {
    const store = createStore({
      claim: vi.fn(async () => [createEvent()]),
    });
    const processEvent = vi.fn(async () => ({
      outcome: "ignored" as const,
      detail: "provider_payment_not_found",
      storeId: null,
    }));

    const result = await runBillingWorker(
      { store, processEvent, random: () => 0.5, logger: vi.fn() },
      { maxEvents: 1 },
    );

    expect(result.retried).toBe(1);
    expect(store.fail).toHaveBeenCalledWith("row-1", "lease-1", "provider_payment_not_found", {
      retryable: true,
      delaySeconds: 15,
      maxAttempts: 8,
    });
  });

  it("envia estorno parcial para dead letter", async () => {
    const store = createStore({
      claim: vi.fn(async () => [createEvent({ eventType: "PAYMENT_PARTIALLY_REFUNDED" })]),
    });
    const processEvent = vi.fn(async () => ({
      outcome: "ignored" as const,
      detail: "manual_review_partial_refund",
      storeId: null,
    }));

    const result = await runBillingWorker(
      { store, processEvent, random: () => 0.5, logger: vi.fn() },
      { maxEvents: 1 },
    );

    expect(result.deadLettered).toBe(1);
    expect(store.fail).toHaveBeenCalledWith("row-1", "lease-1", "manual_review_partial_refund", {
      retryable: false,
      delaySeconds: 0,
      maxAttempts: 8,
    });
  });

  it("não repete divergência de valor e a mantém para revisão", async () => {
    const store = createStore({
      claim: vi.fn(async () => [createEvent()]),
    });
    const processEvent = vi.fn(async () => {
      throw new BillingProcessingError("amount_mismatch");
    });

    const result = await runBillingWorker(
      { store, processEvent, random: () => 0.5, logger: vi.fn() },
      { maxEvents: 1 },
    );

    expect(result.deadLettered).toBe(1);
    expect(store.fail).toHaveBeenCalledWith("row-1", "lease-1", "amount_mismatch", {
      retryable: false,
      delaySeconds: 0,
      maxAttempts: 8,
    });
  });

  it("esgota tentativas de erro transitório e marca dead letter", async () => {
    const store = createStore({
      claim: vi.fn(async () => [createEvent({ attempts: 8 })]),
    });
    const processEvent = vi.fn(async () => {
      throw new AsaasError("TIMEOUT", "timeout");
    });

    const result = await runBillingWorker(
      { store, processEvent, random: () => 0.5, logger: vi.fn() },
      { maxEvents: 1, maxAttempts: 8 },
    );

    expect(result.deadLettered).toBe(1);
    expect(store.fail).toHaveBeenCalledWith(
      "row-1",
      "lease-1",
      "attempts_exhausted:asaas_timeout",
      { retryable: false, delaySeconds: 0, maxAttempts: 8 },
    );
  });

  it("recupera lease antes de reivindicar e contabiliza o dead letter da recuperação", async () => {
    const store = createStore({
      recoverStale: vi.fn(async () => ({ recovered: 2, deadLettered: 1 })),
    });

    const result = await runBillingWorker(
      {
        store,
        processEvent: vi.fn(),
        random: () => 0.5,
        logger: vi.fn(),
      },
      { maxEvents: 1 },
    );

    expect(store.recoverStale).toHaveBeenCalledWith(8);
    expect(result).toMatchObject({ retried: 2, deadLettered: 1, claimed: 0 });
  });

  it("falha o job sem processar quando a recuperação falha", async () => {
    const store = createStore({
      recoverStale: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const processEvent = vi.fn();

    const result = await runBillingWorker(
      { store, processEvent, random: () => 0.5, logger: vi.fn() },
      { maxEvents: 1 },
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("recovery_failed:processing_error");
    expect(processEvent).not.toHaveBeenCalled();
    expect(store.finishJobRun).toHaveBeenCalled();
  });

  it("falha o job quando o claim do banco falha", async () => {
    const store = createStore({
      claim: vi.fn(async () => {
        throw new Error("db down");
      }),
    });

    const result = await runBillingWorker(
      { store, processEvent: vi.fn(), random: () => 0.5, logger: vi.fn() },
      { maxEvents: 1 },
    );

    expect(result).toMatchObject({ status: "failed", error: "claim_failed:processing_error" });
  });

  it("não registra payload, documento ou credencial nos logs", async () => {
    const secret = "documento-secreto-12345678900";
    const logger = vi.fn();
    const store = createStore({
      claim: vi.fn(async () => [
        createEvent({ payload: { payment: { subscription: "sub_1", cpfCnpj: secret } } }),
      ]),
    });

    await runBillingWorker(
      {
        store,
        processEvent: vi.fn(async () => ({
          outcome: "processed" as const,
          detail: "payment_confirmed",
          storeId: "store-1",
        })),
        random: () => 0.5,
        logger,
      },
      { maxEvents: 1 },
    );

    expect(JSON.stringify(logger.mock.calls)).not.toContain(secret);
  });
});
