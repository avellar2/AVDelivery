import { describe, expect, it, vi } from "vitest";

import {
  applyProviderPayment,
  BillingProcessingError,
  type BillingAdminClient,
} from "@/modules/billing/reconcile-core";
import type { AsaasPayment } from "@/modules/billing/providers/asaas/types";

function payment(): AsaasPayment {
  return {
    id: "pay_1",
    customer: "cus_1",
    subscription: "sub_1",
    billingType: "PIX",
    value: 59.9,
    status: "CONFIRMED",
    dueDate: "2026-11-05",
    paymentDate: null,
    confirmedDate: "2026-11-05",
    clientPaymentDate: null,
    invoiceUrl: "https://sandbox.asaas.com/i/pay_1",
    bankSlipUrl: null,
    externalReference: null,
    description: null,
    deleted: false,
  };
}

function adminReturning(error: unknown): BillingAdminClient {
  return { rpc: vi.fn(async () => ({ data: null, error })) } as unknown as BillingAdminClient;
}

describe("erros da RPC de pagamento", () => {
  it("preserva o motivo de um erro PostgREST que não é instância de Error", async () => {
    const admin = adminReturning({ message: "amount_mismatch | p_amount_cents=100" });

    await expect(
      applyProviderPayment(admin, payment(), {
        eventId: null,
        eventType: "RECONCILIATION",
        payload: {},
      }),
    ).rejects.toMatchObject({
      name: "BillingProcessingError",
      reason: "amount_mismatch",
    });
  });

  it("distingue recurso ainda desconhecido de divergência permanente", async () => {
    const admin = adminReturning({ message: "external_subscription_unknown" });

    const error = await applyProviderPayment(admin, payment(), {
      eventId: null,
      eventType: "RECONCILIATION",
      payload: {},
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(BillingProcessingError);
    expect((error as BillingProcessingError).reason).toBe("external_subscription_unknown");
  });
});
