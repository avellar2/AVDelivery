import { describe, expect, it } from "vitest";

import {
  DELIVERY_STATUSES,
  DELIVERY_STATUS_LABELS,
  canCancelDelivery,
  canCompleteDelivery,
  canStartDelivery,
  deliveryStatusLabel,
  isActiveDeliveryStatus,
  isDeliveryStatus,
} from "@/modules/deliveries/constants";
import { resolveDriverStore } from "@/modules/deliveries/driver-store";
import type { StoreMembershipSummary } from "@/modules/memberships/resolve-active-store";

function membership(
  storeId: string,
  role: StoreMembershipSummary["role"],
  storeActive = true,
): StoreMembershipSummary {
  return {
    membershipId: `membership-${storeId}`,
    storeId,
    storeName: `Loja ${storeId}`,
    storeSlug: storeId,
    storeActive,
    role,
  };
}

describe("status de entrega", () => {
  it("expõe exatamente os quatro estados", () => {
    expect(DELIVERY_STATUSES).toEqual(["assigned", "picked_up", "delivered", "canceled"]);
  });

  it("reconhece apenas status válidos", () => {
    expect(isDeliveryStatus("assigned")).toBe(true);
    expect(isDeliveryStatus("picked_up")).toBe(true);
    expect(isDeliveryStatus("delivered")).toBe(true);
    expect(isDeliveryStatus("canceled")).toBe(true);
    expect(isDeliveryStatus("in_transit")).toBe(false);
    expect(isDeliveryStatus(null)).toBe(false);
  });

  it("considera ativas apenas as entregas atribuídas ou em rota", () => {
    expect(isActiveDeliveryStatus("assigned")).toBe(true);
    expect(isActiveDeliveryStatus("picked_up")).toBe(true);
    expect(isActiveDeliveryStatus("delivered")).toBe(false);
    expect(isActiveDeliveryStatus("canceled")).toBe(false);
  });

  it("permite iniciar e cancelar apenas entregas atribuídas", () => {
    expect(canStartDelivery("assigned")).toBe(true);
    expect(canStartDelivery("picked_up")).toBe(false);
    expect(canCancelDelivery("assigned")).toBe(true);
    expect(canCancelDelivery("picked_up")).toBe(false);
    expect(canCancelDelivery("canceled")).toBe(false);
  });

  it("permite concluir apenas entregas coletadas", () => {
    expect(canCompleteDelivery("picked_up")).toBe(true);
    expect(canCompleteDelivery("assigned")).toBe(false);
    expect(canCompleteDelivery("delivered")).toBe(false);
  });

  it("traduz todos os estados", () => {
    for (const status of DELIVERY_STATUSES) {
      expect(deliveryStatusLabel(status)).toBe(DELIVERY_STATUS_LABELS[status]);
      expect(deliveryStatusLabel(status).length).toBeGreaterThan(0);
    }
  });
});

describe("seleção da loja do entregador", () => {
  it("não encontra loja quando o usuário não é entregador", () => {
    expect(resolveDriverStore([], null)).toEqual({ status: "none" });
    expect(resolveDriverStore([membership("loja-1", "employee")], "loja-1")).toEqual({
      status: "none",
    });
  });

  it("seleciona automaticamente quando há apenas uma loja de entrega", () => {
    const only = membership("loja-1", "driver");

    expect(resolveDriverStore([only], null)).toEqual({ status: "active", membership: only });
  });

  it("pede escolha quando há mais de uma loja e nenhuma foi informada", () => {
    const resolution = resolveDriverStore(
      [membership("loja-1", "driver"), membership("loja-2", "driver")],
      null,
    );

    expect(resolution.status).toBe("choose");

    if (resolution.status === "choose") {
      expect(resolution.memberships.map((item) => item.storeId)).toEqual(["loja-1", "loja-2"]);
    }
  });

  it("respeita a loja informada apenas se for de entrega", () => {
    const driverStore = membership("loja-2", "driver");
    const resolution = resolveDriverStore([membership("loja-1", "driver"), driverStore], "loja-2");

    expect(resolution).toEqual({ status: "active", membership: driverStore });
  });

  it("ignora lojas onde o usuário não é entregador", () => {
    const driverStore = membership("loja-2", "driver");
    const resolution = resolveDriverStore([membership("loja-1", "owner"), driverStore], "loja-1");

    expect(resolution.status).toBe("active");

    if (resolution.status === "active") {
      expect(resolution.membership.storeId).toBe("loja-2");
    }
  });
});
