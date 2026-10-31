"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getDeliveryLocationAction,
  shareDeliveryLocationAction,
  stopDeliveryLocationSharingAction,
} from "./actions";
import { isAcceptableAccuracy } from "./geo";
import { decideLocationTransmission, type SentSample } from "./throttle";

export type LocationSharingStatus =
  "idle" | "starting" | "waiting" | "active" | "denied" | "unsupported" | "error" | "stopped";

export type LocationSharingState = {
  status: LocationSharingStatus;
  message: string | null;
  lastSentAt: string | null;
  lastRecordedAt: string | null;
  lastAccuracyMeters: number | null;
  pageHidden: boolean;
};

const INITIAL_STATE: LocationSharingState = {
  status: "idle",
  message: null,
  lastSentAt: null,
  lastRecordedAt: null,
  lastAccuracyMeters: null,
  pageHidden: false,
};

const TERMINAL_ERROR_CODES = new Set([
  "unauthorized",
  "forbidden",
  "delivery_not_found",
  "delivery_not_started",
  "delivery_completed",
  "delivery_not_active",
  "driver_inactive",
  "driver_not_member",
  "order_not_out_for_delivery",
  "order_not_available",
]);

/**
 * Voluntary foreground location sharing.
 *
 * This uses `navigator.geolocation.watchPosition` while the page is open. It is
 * not a background tracker: mobile browsers may throttle or suspend it when the
 * tab is hidden or the screen is locked. The UI says so explicitly.
 */
export function useLocationSharing(input: {
  deliveryId: string;
  enabled: boolean;
}): LocationSharingState & { stop: () => void } {
  const { deliveryId, enabled } = input;
  const [state, setState] = useState<LocationSharingState>(INITIAL_STATE);
  const watchRef = useRef<number | null>(null);
  const lastSentRef = useRef<SentSample | null>(null);
  const inFlightRef = useRef(false);
  const enabledRef = useRef(enabled);

  const clearWatch = useCallback(() => {
    if (watchRef.current !== null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const result = await getDeliveryLocationAction(deliveryId);

        if (cancelled || !result.ok || !result.location) {
          return;
        }

        const location = result.location;

        setState((previous) => ({
          ...previous,
          lastSentAt: previous.lastSentAt ?? location.updatedAt,
          lastRecordedAt: previous.lastRecordedAt ?? location.recordedAt,
          lastAccuracyMeters: previous.lastAccuracyMeters ?? location.accuracyMeters,
        }));
      } catch {
        // Reading the last stored position is informative only.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [deliveryId, enabled]);

  useEffect(() => {
    function handleVisibility() {
      const hidden = document.visibilityState === "hidden";
      setState((previous) =>
        previous.pageHidden === hidden ? previous : { ...previous, pageHidden: hidden },
      );
    }

    document.addEventListener("visibilitychange", handleVisibility);
    handleVisibility();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    enabledRef.current = enabled;

    if (!enabled) {
      clearWatch();
      return;
    }

    clearWatch();
    lastSentRef.current = null;

    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      queueMicrotask(() => {
        setState((previous) => ({
          ...previous,
          status: "unsupported",
          message: "Este navegador não oferece acesso à localização.",
        }));
      });
      return;
    }

    if (typeof window !== "undefined" && !window.isSecureContext) {
      queueMicrotask(() => {
        setState((previous) => ({
          ...previous,
          status: "unsupported",
          message: "O compartilhamento de localização exige uma conexão HTTPS.",
        }));
      });
      return;
    }

    queueMicrotask(() => {
      setState((previous) => ({
        ...previous,
        status: "starting",
        message: "Solicitando permissão de localização ao navegador...",
      }));
    });

    function handleError(error: GeolocationPositionError) {
      if (!enabledRef.current) {
        return;
      }

      if (error.code === error.PERMISSION_DENIED) {
        clearWatch();
        setState((previous) => ({
          ...previous,
          status: "denied",
          message:
            "Permissão de localização negada. Autorize o GPS para este site nas configurações do navegador e tente novamente.",
        }));
        return;
      }

      if (error.code === error.POSITION_UNAVAILABLE) {
        setState((previous) => ({
          ...previous,
          status: "waiting",
          message:
            "GPS indisponível no momento. Verifique se a localização do celular está ligada.",
        }));
        return;
      }

      setState((previous) => ({
        ...previous,
        status: "waiting",
        message: "O GPS demorou para responder. Continuamos tentando.",
      }));
    }

    function handlePosition(position: GeolocationPosition) {
      if (!enabledRef.current) {
        return;
      }

      const { latitude, longitude } = position.coords;
      const accuracyMeters =
        typeof position.coords.accuracy === "number"
          ? position.coords.accuracy
          : Number.POSITIVE_INFINITY;
      const recordedAt = new Date(position.timestamp || Date.now()).toISOString();

      if (!isAcceptableAccuracy(accuracyMeters)) {
        const detail = Number.isFinite(accuracyMeters) ? ` (±${Math.round(accuracyMeters)} m)` : "";

        setState((previous) => ({
          ...previous,
          status: "waiting",
          message: `Sinal de GPS impreciso${detail}. Aguardando melhor precisão.`,
        }));
        return;
      }

      const decision = decideLocationTransmission({
        previous: lastSentRef.current,
        next: { latitude, longitude, accuracyMeters },
        now: Date.now(),
      });

      if (!decision.send) {
        if (decision.reason === "invalid") {
          setState((previous) => ({
            ...previous,
            status: "waiting",
            message: "A posição recebida é inválida. Aguardando um novo sinal.",
          }));
        }
        return;
      }

      if (inFlightRef.current) {
        return;
      }

      inFlightRef.current = true;

      void (async () => {
        try {
          const result = await shareDeliveryLocationAction({
            deliveryId,
            latitude,
            longitude,
            accuracyMeters,
            recordedAt,
          });

          if (!enabledRef.current) {
            return;
          }

          if (!result.ok) {
            if (TERMINAL_ERROR_CODES.has(result.code)) {
              clearWatch();
              setState((previous) => ({ ...previous, status: "stopped", message: result.message }));
              return;
            }

            setState((previous) => ({ ...previous, status: "error", message: result.message }));
            return;
          }

          lastSentRef.current = { latitude, longitude, sentAt: Date.now() };

          setState((previous) => ({
            ...previous,
            status: "active",
            message: result.reason === "rate_limited" ? "Aguardando o próximo envio." : null,
            lastSentAt: new Date().toISOString(),
            lastRecordedAt: recordedAt,
            lastAccuracyMeters: accuracyMeters,
          }));
        } catch {
          if (enabledRef.current) {
            setState((previous) => ({
              ...previous,
              status: "error",
              message: "Não foi possível enviar a posição. Tentaremos novamente.",
            }));
          }
        } finally {
          inFlightRef.current = false;
        }
      })();
    }

    watchRef.current = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: true,
      maximumAge: 5_000,
      timeout: 15_000,
    });

    return () => {
      clearWatch();
    };
  }, [clearWatch, deliveryId, enabled]);

  const stop = useCallback(() => {
    enabledRef.current = false;
    clearWatch();
    setState((previous) => ({ ...previous, status: "idle", message: null }));

    void stopDeliveryLocationSharingAction(deliveryId).catch(() => undefined);
  }, [clearWatch, deliveryId]);

  return { ...state, stop };
}
