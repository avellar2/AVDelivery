import { describe, expect, it } from "vitest";

import {
  ASAAS_WEBHOOK_MAX_BYTES,
  isSupportedEvent,
  isSupportedPaymentEvent,
  isSupportedSubscriptionEvent,
  parseAsaasWebhook,
  webhookTokenMatches,
} from "@/modules/billing/providers/asaas/webhook";

const token = "token-de-webhook-sandbox-com-32-caracteres";

describe("autenticação do webhook Asaas", () => {
  it("aceita exatamente o token configurado", () => {
    expect(webhookTokenMatches(token, token)).toBe(true);
  });

  it("rejeita token ausente, vazio, diferente ou com espaço extra", () => {
    expect(webhookTokenMatches(null, token)).toBe(false);
    expect(webhookTokenMatches(undefined, token)).toBe(false);
    expect(webhookTokenMatches("", token)).toBe(false);
    expect(webhookTokenMatches(`${token}x`, token)).toBe(false);
    expect(webhookTokenMatches(` ${token}`, token)).toBe(false);
    expect(webhookTokenMatches(token, "")).toBe(false);
  });

  it("mantém um limite explícito de payload", () => {
    expect(ASAAS_WEBHOOK_MAX_BYTES).toBe(256 * 1024);
  });
});

describe("estrutura do webhook", () => {
  it("extrai o envelope de pagamento", () => {
    const result = parseAsaasWebhook({
      id: "evt_123",
      event: "PAYMENT_CONFIRMED",
      payment: {
        id: "pay_123",
        subscription: "sub_123",
        customer: "cus_123",
        status: "CONFIRMED",
      },
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.event).toMatchObject({
        eventId: "evt_123",
        eventType: "PAYMENT_CONFIRMED",
        paymentId: "pay_123",
        subscriptionId: "sub_123",
        resourceType: "payment",
        resourceId: "pay_123",
      });
    }
  });

  it("extrai o envelope de assinatura", () => {
    const result = parseAsaasWebhook({
      id: "evt_456",
      event: "SUBSCRIPTION_UPDATED",
      subscription: { id: "sub_123", status: "ACTIVE" },
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.event.resourceType).toBe("subscription");
      expect(result.event.subscriptionId).toBe("sub_123");
    }
  });

  it("rejeita evento de pagamento sem id de pagamento", () => {
    expect(parseAsaasWebhook({ id: "evt_1", event: "PAYMENT_CONFIRMED", payment: {} })).toEqual({
      ok: false,
      reason: "invalid_structure",
    });
  });

  it("rejeita evento de assinatura sem id de assinatura", () => {
    expect(parseAsaasWebhook({ id: "evt_1", event: "SUBSCRIPTION_UPDATED" })).toEqual({
      ok: false,
      reason: "invalid_structure",
    });
  });

  it("rejeita envelope sem id ou evento", () => {
    expect(parseAsaasWebhook({})).toEqual({ ok: false, reason: "invalid_structure" });
    expect(parseAsaasWebhook({ id: "evt_1" })).toEqual({
      ok: false,
      reason: "invalid_structure",
    });
    expect(parseAsaasWebhook(null)).toEqual({ ok: false, reason: "invalid_structure" });
  });

  it("aceita eventos desconhecidos sem inventar recurso", () => {
    const result = parseAsaasWebhook({ id: "evt_789", event: "TRANSFER_CREATED" });
    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.event.resourceType).toBeNull();
      expect(result.event.paymentId).toBeNull();
    }
  });
});

describe("eventos suportados", () => {
  it("reconhece eventos de pagamento e assinatura documentados", () => {
    expect(isSupportedPaymentEvent("PAYMENT_CONFIRMED")).toBe(true);
    expect(isSupportedPaymentEvent("PAYMENT_REFUNDED")).toBe(true);
    expect(isSupportedPaymentEvent("PAYMENT_CHARGEBACK_REQUESTED")).toBe(true);
    expect(isSupportedSubscriptionEvent("SUBSCRIPTION_DELETED")).toBe(true);
    expect(isSupportedEvent("PAYMENT_RECEIVED")).toBe(true);
  });

  it("não trata eventos desconhecidos como suportados", () => {
    expect(isSupportedEvent("TRANSFER_CREATED")).toBe(false);
    expect(isSupportedPaymentEvent("PAYMENT_SOMETHING_NEW")).toBe(false);
  });
});
