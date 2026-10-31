import { describe, expect, it } from "vitest";

import {
  areValidCoordinates,
  haversineDistanceMeters,
  isAcceptableAccuracy,
} from "@/modules/tracking/geo";
import {
  LOCATION_BASE_INTERVAL_MS,
  LOCATION_HEARTBEAT_MS,
  LOCATION_MAX_ACCURACY_METERS,
  LOCATION_MIN_MOVEMENT_METERS,
  LOCATION_MOVED_INTERVAL_MS,
  LOCATION_STALE_AFTER_MS,
} from "@/modules/tracking/constants";
import { getDeliveryMapState } from "@/modules/tracking/status";
import { decideLocationTransmission } from "@/modules/tracking/throttle";
import { shareLocationSchema } from "@/modules/tracking/validation";

const base = { latitude: -23.55052, longitude: -46.633308 };

describe("geo de rastreamento", () => {
  it("valida faixas de latitude e longitude", () => {
    expect(areValidCoordinates({ latitude: 0, longitude: 0 })).toBe(true);
    expect(areValidCoordinates({ latitude: -90, longitude: 180 })).toBe(true);
    expect(areValidCoordinates({ latitude: 90.1, longitude: 0 })).toBe(false);
    expect(areValidCoordinates({ latitude: 0, longitude: -180.1 })).toBe(false);
    expect(areValidCoordinates({ latitude: Number.NaN, longitude: 0 })).toBe(false);
    expect(areValidCoordinates({ latitude: Number.POSITIVE_INFINITY, longitude: 0 })).toBe(false);
  });

  it("calcula distância aproximada em metros", () => {
    const oneDegreeLatitude = haversineDistanceMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 },
    );

    expect(oneDegreeLatitude).toBeGreaterThan(110_000);
    expect(oneDegreeLatitude).toBeLessThan(112_500);

    const nearby = haversineDistanceMeters({ latitude: -23.55, longitude: -46.63 }, base);

    expect(nearby).toBeGreaterThan(300);
    expect(nearby).toBeLessThan(500);
  });

  it("rejeita precisão inválida para envio", () => {
    expect(isAcceptableAccuracy(25)).toBe(true);
    expect(isAcceptableAccuracy(0)).toBe(false);
    expect(isAcceptableAccuracy(Number.NaN)).toBe(false);
    expect(isAcceptableAccuracy(LOCATION_MAX_ACCURACY_METERS + 1)).toBe(false);
  });
});

describe("throttle de envio de posição", () => {
  const now = 1_700_000_000_000;

  it("envia a primeira posição válida", () => {
    expect(
      decideLocationTransmission({
        previous: null,
        next: { ...base, accuracyMeters: 20 },
        now,
      }),
    ).toMatchObject({ send: true, reason: "first" });
  });

  it("descarta posição inválida e sinal impreciso", () => {
    expect(
      decideLocationTransmission({
        previous: null,
        next: { latitude: 120, longitude: 0, accuracyMeters: 10 },
        now,
      }),
    ).toMatchObject({ send: false, reason: "invalid" });

    expect(
      decideLocationTransmission({
        previous: null,
        next: { ...base, accuracyMeters: LOCATION_MAX_ACCURACY_METERS + 1 },
        now,
      }),
    ).toMatchObject({ send: false, reason: "imprecise" });
  });

  it("não envia antes do intervalo mínimo mesmo com deslocamento", () => {
    const previous = { ...base, sentAt: now - LOCATION_MOVED_INTERVAL_MS + 1 };

    expect(
      decideLocationTransmission({
        previous,
        next: { latitude: base.latitude + 0.01, longitude: base.longitude, accuracyMeters: 15 },
        now,
      }),
    ).toMatchObject({ send: false, reason: "too_soon" });
  });

  it("envia por deslocamento a partir de 25 m após 8 s", () => {
    const previous = { ...base, sentAt: now - LOCATION_MOVED_INTERVAL_MS };

    expect(
      decideLocationTransmission({
        previous,
        next: {
          latitude: base.latitude + 0.0003,
          longitude: base.longitude,
          accuracyMeters: 15,
        },
        now,
      }),
    ).toMatchObject({ send: true, reason: "moved" });
  });

  it("evita posição idêntica antes do heartbeat", () => {
    const previous = { ...base, sentAt: now - LOCATION_BASE_INTERVAL_MS };

    expect(
      decideLocationTransmission({
        previous,
        next: { ...base, accuracyMeters: 15 },
        now,
      }),
    ).toMatchObject({ send: false, reason: "too_soon" });

    expect(
      decideLocationTransmission({
        previous: { ...base, sentAt: now - LOCATION_HEARTBEAT_MS },
        next: { ...base, accuracyMeters: 15 },
        now,
      }),
    ).toMatchObject({ send: true, reason: "heartbeat" });
  });

  it("envia deslocamento pequeno no intervalo base", () => {
    const previous = { ...base, sentAt: now - LOCATION_BASE_INTERVAL_MS };

    expect(
      decideLocationTransmission({
        previous,
        next: {
          latitude: base.latitude + 0.00012,
          longitude: base.longitude,
          accuracyMeters: 20,
        },
        now,
      }),
    ).toMatchObject({ send: true, reason: "interval" });
  });

  it("conhece o limite de deslocamento configurado", () => {
    expect(LOCATION_MIN_MOVEMENT_METERS).toBeGreaterThan(0);
    expect(LOCATION_STALE_AFTER_MS).toBeGreaterThan(LOCATION_HEARTBEAT_MS);
  });
});

describe("estado do mapa de acompanhamento", () => {
  const now = Date.parse("2026-10-31T12:00:00.000Z");

  it("não iniciou antes da coleta", () => {
    expect(getDeliveryMapState({ status: null, hasLocation: false, updatedAt: null, now })).toBe(
      "not_started",
    );
    expect(
      getDeliveryMapState({ status: "assigned", hasLocation: false, updatedAt: null, now }),
    ).toBe("not_started");
  });

  it("aguarda a primeira posição durante a rota", () => {
    expect(
      getDeliveryMapState({ status: "picked_up", hasLocation: false, updatedAt: null, now }),
    ).toBe("waiting");
  });

  it("marca posição recente como ativa", () => {
    expect(
      getDeliveryMapState({
        status: "picked_up",
        hasLocation: true,
        updatedAt: new Date(now - 10_000).toISOString(),
        now,
      }),
    ).toBe("active");
  });

  it("marca posição antiga como desatualizada", () => {
    expect(
      getDeliveryMapState({
        status: "picked_up",
        hasLocation: true,
        updatedAt: new Date(now - LOCATION_STALE_AFTER_MS - 1).toISOString(),
        now,
      }),
    ).toBe("stale");

    expect(
      getDeliveryMapState({
        status: "picked_up",
        hasLocation: true,
        updatedAt: "not-a-date",
        now,
      }),
    ).toBe("stale");
  });

  it("encerra o compartilhamento depois de entregue ou cancelada", () => {
    expect(
      getDeliveryMapState({ status: "delivered", hasLocation: false, updatedAt: null, now }),
    ).toBe("ended");
    expect(
      getDeliveryMapState({ status: "canceled", hasLocation: false, updatedAt: null, now }),
    ).toBe("ended");
  });
});

describe("validação do envio de localização", () => {
  const valid = {
    deliveryId: "3f0c1a9b-7d2e-4b1a-9c3d-2e4f6a8b0c1d",
    latitude: -23.55052,
    longitude: -46.633308,
    accuracyMeters: 12.5,
    recordedAt: new Date().toISOString(),
  };

  it("aceita uma amostra válida", () => {
    expect(shareLocationSchema.safeParse(valid).success).toBe(true);
  });

  it("recusa coordenadas fora das faixas", () => {
    expect(shareLocationSchema.safeParse({ ...valid, latitude: 91 }).success).toBe(false);
    expect(shareLocationSchema.safeParse({ ...valid, longitude: -181 }).success).toBe(false);
  });

  it("recusa precisão e identificadores inválidos", () => {
    expect(shareLocationSchema.safeParse({ ...valid, accuracyMeters: 0 }).success).toBe(false);
    expect(shareLocationSchema.safeParse({ ...valid, accuracyMeters: 20_001 }).success).toBe(false);
    expect(shareLocationSchema.safeParse({ ...valid, deliveryId: "abc" }).success).toBe(false);
  });

  it("recusa data inválida", () => {
    expect(shareLocationSchema.safeParse({ ...valid, recordedAt: "ontem" }).success).toBe(false);
  });
});
