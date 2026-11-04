import { describe, expect, it } from "vitest";

import {
  canManagePlatformBilling,
  canViewSubscription,
  commercialStateLabel,
  commercialStateTone,
  computeBillingMetrics,
  computeMrrCents,
  daysRemaining,
  effectiveSubscriptionState,
  hasCommercialAccess,
  isCommerciallyBlocked,
  type SubscriptionStateInput,
} from "@/modules/subscriptions/access";
import type { AdminBillingStore } from "@/modules/subscriptions/types";
import type { CommercialState, SubscriptionStatus } from "@/types/database";

const DAY = 86_400_000;

function input(overrides: Partial<SubscriptionStateInput> = {}): SubscriptionStateInput {
  return {
    status: "trialing",
    isExempt: false,
    trialEndsAt: null,
    currentPeriodEnd: null,
    graceEndsAt: null,
    graceDays: 5,
    ...overrides,
  };
}

function store(overrides: Partial<AdminBillingStore> = {}): AdminBillingStore {
  return {
    storeId: "store-1",
    name: "Loja",
    slug: "loja",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    memberCount: 1,
    ownerCount: 1,
    subscriptionId: "sub-1",
    status: "active",
    isExempt: false,
    planId: "plan-1",
    planName: "AVDelivery",
    priceCents: 5990,
    currency: "BRL",
    trialStartedAt: null,
    trialEndsAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    graceEndsAt: null,
    canceledAt: null,
    state: "active",
    ...overrides,
  };
}

describe("estado comercial efetivo", () => {
  const now = new Date("2026-11-04T12:00:00.000Z");

  it("considera o teste válido até o instante final, inclusive", () => {
    const trialEnd = new Date(now.getTime() + DAY).toISOString();
    const state = effectiveSubscriptionState(input({ trialEndsAt: trialEnd }), now);

    expect(state).toBe("trialing");
    expect(effectiveSubscriptionState(input({ trialEndsAt: trialEnd }), new Date(trialEnd))).toBe(
      "trialing",
    );
  });

  it("entra em carência imediatamente após o teste e respeita grace_days", () => {
    const trialEnd = new Date(now.getTime() - DAY).toISOString();
    const trial = input({ trialEndsAt: trialEnd, graceDays: 5 });

    expect(effectiveSubscriptionState(trial, now)).toBe("grace");
    expect(
      effectiveSubscriptionState(trial, new Date(new Date(trialEnd).getTime() + 4 * DAY)),
    ).toBe("grace");
    expect(
      effectiveSubscriptionState(trial, new Date(new Date(trialEnd).getTime() + 5 * DAY)),
    ).toBe("grace");
    expect(
      effectiveSubscriptionState(trial, new Date(new Date(trialEnd).getTime() + 5 * DAY + 1)),
    ).toBe("expired");
  });

  it("considera assinatura ativa até o fim do período, inclusive", () => {
    const periodEnd = new Date(now.getTime() + 10 * DAY).toISOString();
    const active = input({ status: "active", currentPeriodEnd: periodEnd });

    expect(effectiveSubscriptionState(active, now)).toBe("active");
    expect(effectiveSubscriptionState(active, new Date(periodEnd))).toBe("active");
    expect(effectiveSubscriptionState(active, new Date(new Date(periodEnd).getTime() + 1))).toBe(
      "grace",
    );
  });

  it("respeita a carência explícita registrada na assinatura", () => {
    const nowMs = now.getTime();
    const active = input({
      status: "active",
      currentPeriodEnd: new Date(nowMs - DAY).toISOString(),
      graceEndsAt: new Date(nowMs + DAY).toISOString(),
    });

    expect(effectiveSubscriptionState(active, now)).toBe("grace");
    expect(effectiveSubscriptionState(active, new Date(nowMs + 2 * DAY))).toBe("expired");
  });

  it("expira a assinatura quando o fim do período não está registrado", () => {
    expect(
      effectiveSubscriptionState(input({ status: "active", currentPeriodEnd: null }), now),
    ).toBe("expired");
    expect(effectiveSubscriptionState(input({ trialEndsAt: null }), now)).toBe("expired");
  });

  it("trata estados terminais antes de qualquer data", () => {
    expect(
      effectiveSubscriptionState(
        input({
          status: "canceled",
          isExempt: true,
          trialEndsAt: new Date(now.getTime() + DAY).toISOString(),
        }),
        now,
      ),
    ).toBe("canceled");
    expect(
      effectiveSubscriptionState(
        input({
          status: "expired",
          isExempt: true,
          trialEndsAt: new Date(now.getTime() + DAY).toISOString(),
        }),
        now,
      ),
    ).toBe("expired");
  });

  it("faz a isenção administrativa prevalecer sobre datas", () => {
    const exempt = input({
      status: "expired",
      isExempt: true,
      trialEndsAt: new Date(now.getTime() - 30 * DAY).toISOString(),
    });

    // is_exempt prevalece, exceto para status terminais explícitos.
    expect(effectiveSubscriptionState(input({ isExempt: true }), now)).toBe("exempt");
    expect(effectiveSubscriptionState(exempt, now)).toBe("expired");
  });

  it("não concede acesso a estados ausentes ou inativos", () => {
    const blocking: CommercialState[] = ["expired", "canceled", "missing", "inactive"];

    for (const state of blocking) {
      expect(hasCommercialAccess(state)).toBe(false);
    }

    for (const state of ["trialing", "active", "grace", "exempt"] as const) {
      expect(hasCommercialAccess(state)).toBe(true);
    }
  });

  it("distingue bloqueio comercial de loja inativa", () => {
    expect(isCommerciallyBlocked("expired")).toBe(true);
    expect(isCommerciallyBlocked("canceled")).toBe(true);
    expect(isCommerciallyBlocked("missing")).toBe(true);
    expect(isCommerciallyBlocked("inactive")).toBe(false);
    expect(isCommerciallyBlocked("grace")).toBe(false);
  });
});

describe("dias restantes", () => {
  const now = new Date("2026-11-04T12:00:00.000Z");

  it("arredonda para cima e nunca retorna negativo", () => {
    expect(daysRemaining(new Date(now.getTime() + 1.5 * DAY).toISOString(), now)).toBe(2);
    expect(daysRemaining(new Date(now.getTime() + DAY).toISOString(), now)).toBe(1);
    expect(daysRemaining(new Date(now.getTime() - DAY).toISOString(), now)).toBe(0);
  });

  it("retorna nulo para data ausente ou inválida", () => {
    expect(daysRemaining(null, now)).toBeNull();
    expect(daysRemaining("não é data", now)).toBeNull();
  });
});

describe("rótulos e tons do estado comercial", () => {
  it("traduz todos os estados", () => {
    const expected: Record<CommercialState, string> = {
      trialing: "Período de teste",
      active: "Ativa",
      grace: "Em carência",
      exempt: "Isenta (administrativa)",
      expired: "Vencida",
      canceled: "Cancelada",
      inactive: "Loja inativa",
      missing: "Sem assinatura",
    };

    for (const [state, label] of Object.entries(expected)) {
      expect(commercialStateLabel(state as CommercialState)).toBe(label);
    }
  });

  it("mapeia tons de alerta", () => {
    expect(commercialStateTone("active")).toBe("success");
    expect(commercialStateTone("trialing")).toBe("brand");
    expect(commercialStateTone("exempt")).toBe("brand");
    expect(commercialStateTone("grace")).toBe("warning");
    expect(commercialStateTone("expired")).toBe("danger");
    expect(commercialStateTone("canceled")).toBe("danger");
    expect(commercialStateTone("missing")).toBe("neutral");
    expect(commercialStateTone("inactive")).toBe("neutral");
  });
});

describe("receita e métricas administrativas", () => {
  it("conta no MRR apenas assinaturas ativas e não isentas", () => {
    const rows = [
      store({ storeId: "a", state: "active", priceCents: 5990 }),
      store({ storeId: "b", state: "active", priceCents: 9990 }),
      store({ storeId: "c", state: "active", priceCents: 5990, isExempt: true }),
      store({ storeId: "d", state: "trialing", priceCents: 5990 }),
      store({ storeId: "e", state: "grace", priceCents: 5990 }),
      store({ storeId: "f", state: "exempt", priceCents: 5990, isExempt: true }),
      store({ storeId: "g", state: "expired", priceCents: 5990 }),
      store({ storeId: "h", state: "canceled", priceCents: 5990 }),
      store({ storeId: "i", state: "missing", priceCents: null }),
    ];

    expect(computeMrrCents(rows)).toBe(15980);
  });

  it("não trata teste, carência ou isenção como receita", () => {
    const rows = [
      store({ storeId: "a", state: "trialing", priceCents: 5990 }),
      store({ storeId: "b", state: "grace", priceCents: 5990 }),
      store({ storeId: "c", state: "exempt", priceCents: 5990, isExempt: true }),
    ];

    expect(computeMrrCents(rows)).toBe(0);
  });

  it("agrega contagens por estado e separa recebido de MRR nominal", () => {
    const rows = [
      store({ storeId: "a", state: "trialing" }),
      store({ storeId: "b", state: "active" }),
      store({ storeId: "c", state: "active" }),
      store({ storeId: "d", state: "grace" }),
      store({ storeId: "e", state: "expired" }),
      store({ storeId: "f", state: "canceled" }),
      store({ storeId: "g", state: "exempt", isExempt: true }),
      store({ storeId: "h", state: "missing", priceCents: null }),
      store({ storeId: "i", state: "inactive" }),
    ];

    const metrics = computeBillingMetrics(rows, 0);

    expect(metrics).toEqual({
      totalStores: 9,
      trialing: 1,
      active: 2,
      grace: 1,
      expired: 1,
      canceled: 1,
      exempt: 1,
      missing: 1,
      mrrCents: 11980,
      receivedThisMonthCents: 0,
    });
  });

  it("mantém o valor recebido informado sem somar ao MRR", () => {
    const metrics = computeBillingMetrics([store()], 5990);

    expect(metrics.mrrCents).toBe(5990);
    expect(metrics.receivedThisMonthCents).toBe(5990);
  });
});

describe("permissões comerciais", () => {
  it("só o proprietário vê a assinatura no painel da loja", () => {
    expect(canViewSubscription("owner")).toBe(true);

    for (const role of ["manager", "employee", "driver", null, undefined] as const) {
      expect(canViewSubscription(role)).toBe(false);
    }
  });

  it("gestão da plataforma depende de ser superadministrador", () => {
    expect(canManagePlatformBilling(true)).toBe(true);
    expect(canManagePlatformBilling(false)).toBe(false);
  });
});

describe("status aceitos pelo modelo", () => {
  it("mantém o conjunto explícito de estados persistidos", () => {
    const statuses: SubscriptionStatus[] = ["trialing", "active", "grace", "expired", "canceled"];

    for (const status of statuses) {
      const result = effectiveSubscriptionState(
        input({ status, trialEndsAt: null, currentPeriodEnd: null }),
        new Date("2026-11-04T12:00:00.000Z"),
      );

      expect(typeof result).toBe("string");
    }
  });
});
