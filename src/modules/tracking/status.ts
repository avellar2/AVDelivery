import type { DeliveryStatus } from "@/types/database";

import { LOCATION_STALE_AFTER_MS } from "./constants";

export type DeliveryMapState = "not_started" | "waiting" | "active" | "stale" | "ended";

export const DELIVERY_MAP_STATE_LABELS: Record<DeliveryMapState, string> = {
  not_started: "Aguardando coleta",
  waiting: "Aguardando sinal",
  active: "Localização ativa",
  stale: "Última posição recebida",
  ended: "Compartilhamento encerrado",
};

/**
 * Public map state derived only from the delivery status and the last stored
 * position. A position older than 90 s is still shown, but labeled as stale.
 */
export function getDeliveryMapState(input: {
  status: DeliveryStatus | null;
  hasLocation: boolean;
  updatedAt: string | null;
  now?: number;
}): DeliveryMapState {
  const { status, hasLocation, updatedAt } = input;

  if (!status || status === "assigned") {
    return "not_started";
  }

  if (status === "delivered" || status === "canceled") {
    return "ended";
  }

  if (!hasLocation || !updatedAt) {
    return "waiting";
  }

  const updatedAtMs = Date.parse(updatedAt);

  if (!Number.isFinite(updatedAtMs)) {
    return "stale";
  }

  const now = input.now ?? Date.now();

  return now - updatedAtMs <= LOCATION_STALE_AFTER_MS ? "active" : "stale";
}
