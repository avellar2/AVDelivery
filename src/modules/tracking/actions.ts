"use server";

import { reportServerError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/modules/auth/session";

import type { TrackingLocation } from "./types";
import { deliveryIdSchema, shareLocationSchema, type ShareLocationInput } from "./validation";

export type ShareLocationResult =
  | {
      ok: true;
      changed: boolean;
      reason: "out_of_order" | "rate_limited" | null;
      updatedAt: string | null;
    }
  | { ok: false; code: string; message: string };

export type DeliveryLocationResult =
  { ok: true; location: TrackingLocation | null } | { ok: false; message: string };

export type StopSharingResult = { ok: true; cleared: boolean } | { ok: false; message: string };

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return "";
  }

  return error.message.split("|")[0]?.trim() ?? "";
}

function mapSharingError(code: string): string {
  switch (code) {
    case "unauthorized":
      return "Sua sessão expirou. Entre novamente para compartilhar a localização.";
    case "forbidden":
      return "Esta entrega não está atribuída à sua conta.";
    case "delivery_not_found":
      return "Entrega não encontrada.";
    case "delivery_not_started":
      return "Inicie a entrega antes de compartilhar a localização.";
    case "delivery_completed":
      return "A entrega já foi concluída. O compartilhamento foi encerrado.";
    case "delivery_not_active":
      return "Esta entrega foi cancelada ou reatribuída. O compartilhamento foi encerrado.";
    case "driver_inactive":
    case "driver_not_member":
      return "Seu vínculo com a loja não permite compartilhar localização.";
    case "order_not_out_for_delivery":
    case "order_not_available":
      return "O pedido não está mais em rota. O compartilhamento foi encerrado.";
    case "invalid_location":
    case "invalid_coordinates":
    case "invalid_accuracy":
    case "invalid_timestamp":
    case "stale_timestamp":
      return "A posição recebida não é válida. Aguardando um novo sinal de GPS.";
    default:
      return "Não foi possível enviar a localização agora. Tentaremos novamente.";
  }
}

function mapLocation(value: unknown): TrackingLocation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const latitude = Number(record.latitude);
  const longitude = Number(record.longitude);
  const accuracyMeters = Number(record.accuracyMeters);
  const recordedAt = typeof record.recordedAt === "string" ? record.recordedAt : null;
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : null;

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(accuracyMeters) ||
    !recordedAt ||
    !updatedAt
  ) {
    return null;
  }

  return { latitude, longitude, accuracyMeters, recordedAt, updatedAt };
}

export async function shareDeliveryLocationAction(
  input: ShareLocationInput,
): Promise<ShareLocationResult> {
  const user = await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      code: "unauthorized",
      message: mapSharingError("unauthorized"),
    };
  }

  const parsed = shareLocationSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_location",
      message: mapSharingError("invalid_location"),
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("share_delivery_location", {
    p_delivery_id: parsed.data.deliveryId,
    p_latitude: parsed.data.latitude,
    p_longitude: parsed.data.longitude,
    p_accuracy_meters: parsed.data.accuracyMeters,
    p_recorded_at: parsed.data.recordedAt,
  });

  if (error) {
    reportServerError("tracking.share", error);
    const code = errorCode(error) || "unknown";
    return { ok: false, code, message: mapSharingError(code) };
  }

  const record = data && typeof data === "object" && !Array.isArray(data) ? data : null;
  const reason =
    record?.reason === "out_of_order" || record?.reason === "rate_limited" ? record.reason : null;

  return {
    ok: true,
    changed: record?.changed === true,
    reason,
    updatedAt: typeof record?.updatedAt === "string" ? record.updatedAt : null,
  };
}

export async function getDeliveryLocationAction(
  deliveryId: string,
): Promise<DeliveryLocationResult> {
  const user = await getCurrentUser();

  if (!user) {
    return { ok: false, message: mapSharingError("unauthorized") };
  }

  if (!deliveryIdSchema.safeParse(deliveryId).success) {
    return { ok: false, message: "Entrega inválida." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_driver_delivery_location", {
    p_delivery_id: deliveryId,
  });

  if (error) {
    reportServerError("tracking.getDriverLocation", error);
    return { ok: false, message: mapSharingError(errorCode(error)) };
  }

  return { ok: true, location: mapLocation(data) };
}

export async function stopDeliveryLocationSharingAction(
  deliveryId: string,
): Promise<StopSharingResult> {
  const user = await getCurrentUser();

  if (!user) {
    return { ok: false, message: mapSharingError("unauthorized") };
  }

  if (!deliveryIdSchema.safeParse(deliveryId).success) {
    return { ok: false, message: "Entrega inválida." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("clear_delivery_location", {
    p_delivery_id: deliveryId,
  });

  if (error) {
    reportServerError("tracking.stopSharing", error);
    return { ok: false, message: mapSharingError(errorCode(error)) };
  }

  const record = data && typeof data === "object" && !Array.isArray(data) ? data : null;

  return { ok: true, cleared: record?.cleared === true };
}
