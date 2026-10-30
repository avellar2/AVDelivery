import { describe, expect, it } from "vitest";

import {
  allowedNextStatuses,
  canTransition,
  isOrderStatus,
  isTerminalStatus,
} from "@/modules/orders/status";

describe("máquina de estados do pedido", () => {
  it("segue o fluxo de entrega", () => {
    expect(allowedNextStatuses("pending", "delivery")).toEqual(["accepted", "canceled"]);
    expect(allowedNextStatuses("accepted", "delivery")).toEqual(["preparing", "canceled"]);
    expect(allowedNextStatuses("preparing", "delivery")).toEqual(["ready", "canceled"]);
    expect(allowedNextStatuses("ready", "delivery")).toEqual(["out_for_delivery"]);
    expect(allowedNextStatuses("out_for_delivery", "delivery")).toEqual(["delivered"]);
    expect(allowedNextStatuses("delivered", "delivery")).toEqual([]);
    expect(allowedNextStatuses("canceled", "delivery")).toEqual([]);
  });

  it("segue o fluxo de retirada, sem saída para entrega", () => {
    expect(allowedNextStatuses("ready", "pickup")).toEqual(["delivered"]);
    expect(allowedNextStatuses("out_for_delivery", "pickup")).toEqual([]);
  });

  it("bloqueia retrocessos e saltos", () => {
    expect(canTransition("pending", "ready", "delivery")).toBe(false);
    expect(canTransition("preparing", "out_for_delivery", "delivery")).toBe(false);
    expect(canTransition("delivered", "canceled", "delivery")).toBe(false);
    expect(canTransition("canceled", "pending", "delivery")).toBe(false);
    expect(canTransition("accepted", "preparing", "delivery")).toBe(true);
  });

  it("não permite cancelar depois do preparo", () => {
    expect(canTransition("preparing", "canceled", "delivery")).toBe(true);
    expect(canTransition("ready", "canceled", "delivery")).toBe(false);
  });

  it("reconhece status finais", () => {
    expect(isTerminalStatus("delivered")).toBe(true);
    expect(isTerminalStatus("canceled")).toBe(true);
    expect(isTerminalStatus("preparing")).toBe(false);
  });

  it("valida valores de status", () => {
    expect(isOrderStatus("pending")).toBe(true);
    expect(isOrderStatus("paid")).toBe(false);
    expect(isOrderStatus(null)).toBe(false);
  });
});
