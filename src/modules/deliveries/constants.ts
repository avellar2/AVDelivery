import type { DeliveryStatus } from "@/types/database";

export const DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  "assigned",
  "picked_up",
  "delivered",
  "canceled",
];

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  assigned: "Atribuída",
  picked_up: "Em rota",
  delivered: "Entregue",
  canceled: "Cancelada",
};

export const DELIVERY_STATUS_SHORT_LABELS: Record<DeliveryStatus, string> = {
  assigned: "Atribuída",
  picked_up: "Em rota",
  delivered: "Entregue",
  canceled: "Cancelada",
};

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return typeof value === "string" && DELIVERY_STATUSES.includes(value as DeliveryStatus);
}

export function isActiveDeliveryStatus(status: DeliveryStatus): boolean {
  return status === "assigned" || status === "picked_up";
}

export function canStartDelivery(status: DeliveryStatus): boolean {
  return status === "assigned";
}

export function canCompleteDelivery(status: DeliveryStatus): boolean {
  return status === "picked_up";
}

export function canCancelDelivery(status: DeliveryStatus): boolean {
  return status === "assigned";
}

export function deliveryStatusLabel(status: DeliveryStatus): string {
  return DELIVERY_STATUS_LABELS[status];
}
