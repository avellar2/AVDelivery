import type { OrderFulfillmentType, OrderStatus } from "@/types/database";

const DELIVERY_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["accepted", "canceled"],
  accepted: ["preparing", "canceled"],
  preparing: ["ready", "canceled"],
  ready: ["out_for_delivery"],
  out_for_delivery: ["delivered"],
  delivered: [],
  canceled: [],
};

const PICKUP_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["accepted", "canceled"],
  accepted: ["preparing", "canceled"],
  preparing: ["ready", "canceled"],
  ready: ["delivered"],
  out_for_delivery: [],
  delivered: [],
  canceled: [],
};

export function allowedNextStatuses(
  current: OrderStatus,
  fulfillmentType: OrderFulfillmentType,
): OrderStatus[] {
  const map = fulfillmentType === "delivery" ? DELIVERY_TRANSITIONS : PICKUP_TRANSITIONS;
  return [...map[current]];
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return status === "delivered" || status === "canceled";
}

export function canTransition(
  current: OrderStatus,
  next: OrderStatus,
  fulfillmentType: OrderFulfillmentType,
): boolean {
  return allowedNextStatuses(current, fulfillmentType).includes(next);
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" &&
    [
      "pending",
      "accepted",
      "preparing",
      "ready",
      "out_for_delivery",
      "delivered",
      "canceled",
    ].includes(value)
  );
}
