import { describe, expect, it } from "vitest";

import {
  assembleDriverDeliveries,
  canComplete,
  canShare,
  canStart,
  formatAddress,
  isActiveDelivery,
  mapRpcError,
  rpcErrorCode,
} from "../src/lib/delivery";
import type { DeliveryRow, OrderItemOptionRow, OrderRow } from "../src/lib/types";

const delivery = (overrides: Partial<DeliveryRow> = {}): DeliveryRow => ({
  id: "delivery-1",
  store_id: "store-1",
  order_id: "order-1",
  driver_profile_id: "driver-1",
  status: "assigned",
  assigned_at: "2026-10-30T10:00:00.000Z",
  picked_up_at: null,
  delivered_at: null,
  canceled_at: null,
  cancel_reason: null,
  created_at: "2026-10-30T10:00:00.000Z",
  ...overrides,
});

const order = (overrides: Partial<OrderRow> = {}): OrderRow => ({
  id: "order-1",
  store_id: "store-1",
  order_number: 42,
  customer_name: "Ana",
  customer_phone: "11999999999",
  fulfillment_type: "delivery",
  delivery_address_snapshot: {
    street: "Rua A",
    number: "10",
    district: "Centro",
    city: "São Paulo",
  },
  payment_method: "pix",
  payment_status: "paid",
  status: "ready",
  subtotal_cents: 2000,
  delivery_fee_cents: 500,
  total_cents: 2500,
  notes: null,
  created_at: "2026-10-30T10:00:00.000Z",
  ...overrides,
});

describe("rpcErrorCode", () => {
  it("returns the code before the detail separator", () => {
    expect(rpcErrorCode({ message: "delivery_not_active|canceled" })).toBe("delivery_not_active");
  });

  it("handles empty and missing errors", () => {
    expect(rpcErrorCode(null)).toBe("");
    expect(rpcErrorCode({ message: "" })).toBe("");
  });
});

describe("mapRpcError", () => {
  it("maps known codes to Portuguese messages", () => {
    expect(mapRpcError("delivery_not_started")).toContain("Inicie a entrega");
    expect(mapRpcError("unauthorized")).toContain("sessão expirou");
  });

  it("falls back for unknown codes", () => {
    expect(mapRpcError("weird", "falhou")).toBe("falhou");
  });
});

describe("assembleDriverDeliveries", () => {
  it("groups items and their options by order and sorts newest first", () => {
    const older = delivery({ id: "d-old", order_id: "order-1" });
    const newer = delivery({
      id: "d-new",
      order_id: "order-2",
      created_at: "2026-10-31T10:00:00.000Z",
    });

    const result = assembleDriverDeliveries(
      [older, newer],
      [order(), order({ id: "order-2", order_number: 43 })],
      [
        {
          id: "item-1",
          order_id: "order-1",
          product_name_snapshot: "Pizza",
          unit_price_cents: 2000,
          quantity: 1,
          total_cents: 2000,
          notes: null,
        },
      ],
      [
        {
          id: "option-1",
          order_item_id: "item-1",
          option_group_name_snapshot: "Borda",
          option_name_snapshot: "Catupiry",
          additional_price_cents: 300,
          quantity: 1,
        } satisfies OrderItemOptionRow,
      ],
    );

    expect(result.map((entry) => entry.delivery.id)).toEqual(["d-new", "d-old"]);
    expect(result[1]?.items[0]?.options[0]?.option_name_snapshot).toBe("Catupiry");
    expect(result[0]?.items).toEqual([]);
  });

  it("keeps a canceled delivery visible even when its order is not readable", () => {
    const result = assembleDriverDeliveries([delivery({ status: "canceled" })], [], [], []);

    expect(result).toHaveLength(1);
    expect(result[0]?.order).toBeNull();
  });
});

describe("delivery affordances", () => {
  it("only allows start on assigned and complete/share after pickup", () => {
    const assigned = delivery();
    const pickedUp = delivery({ status: "picked_up" });

    expect(canStart(assigned)).toBe(true);
    expect(canComplete(assigned)).toBe(false);
    expect(canShare(assigned)).toBe(false);

    expect(canStart(pickedUp)).toBe(false);
    expect(canComplete(pickedUp)).toBe(true);
    expect(canShare(pickedUp)).toBe(true);
  });

  it("marks only assigned and picked_up as active", () => {
    expect(isActiveDelivery("assigned")).toBe(true);
    expect(isActiveDelivery("picked_up")).toBe(true);
    expect(isActiveDelivery("delivered")).toBe(false);
    expect(isActiveDelivery("canceled")).toBe(false);
  });
});

describe("formatAddress", () => {
  it("formats the snapshot with complement, district and reference", () => {
    expect(
      formatAddress({
        street: "Rua A",
        number: "10",
        complement: "Apto 2",
        district: "Centro",
        city: "São Paulo",
        reference: "Portão azul",
      }),
    ).toBe("Rua A, 10 (Apto 2) — Centro, São Paulo · Ref.: Portão azul");
  });

  it("handles a missing snapshot", () => {
    expect(formatAddress(null)).toBe("Endereço não informado");
    expect(formatAddress({})).toBe("Endereço não informado");
  });
});
