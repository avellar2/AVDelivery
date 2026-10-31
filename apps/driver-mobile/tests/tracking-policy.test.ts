import { describe, expect, it } from "vitest";

import {
  decideSend,
  distanceMeters,
  isUsableFix,
  type GeoFix,
} from "../src/lib/tracking-policy";

const base: GeoFix = {
  latitude: -23.5505,
  longitude: -46.6333,
  accuracyMeters: 12,
  recordedAt: 1_000,
};

/** Roughly one degree of latitude is ~111.32 km. */
function offsetMeters(meters: number, latitude = base.latitude) {
  return latitude + meters / 111_320;
}

describe("isUsableFix", () => {
  it("accepts a plausible fix", () => {
    expect(isUsableFix(base)).toBe(true);
  });

  it("rejects out-of-range coordinates", () => {
    expect(isUsableFix({ ...base, latitude: 91 })).toBe(false);
    expect(isUsableFix({ ...base, longitude: -181 })).toBe(false);
  });

  it("rejects non-finite and imprecise readings", () => {
    expect(isUsableFix({ ...base, latitude: Number.NaN })).toBe(false);
    expect(isUsableFix({ ...base, accuracyMeters: 0 })).toBe(false);
    expect(isUsableFix({ ...base, accuracyMeters: 151 })).toBe(false);
    expect(isUsableFix({ ...base, accuracyMeters: 150 })).toBe(true);
  });
});

describe("distanceMeters", () => {
  it("returns zero for the same point", () => {
    expect(distanceMeters(base, base)).toBeCloseTo(0, 5);
  });

  it("approximates a known latitude offset", () => {
    expect(distanceMeters(base, { ...base, latitude: offsetMeters(100) })).toBeCloseTo(100, 0);
  });
});

describe("decideSend", () => {
  it("always sends the first fix", () => {
    expect(decideSend(null, base, 1_000).reason).toBe("first");
  });

  it("skips a fresh fix that barely moved", () => {
    const previous = { latitude: base.latitude, longitude: base.longitude, sentAt: 1_000 };
    const result = decideSend(
      previous,
      { ...base, latitude: offsetMeters(3), recordedAt: 12_000 },
      12_000,
    );

    expect(result.send).toBe(false);
    expect(result.reason).toBe("drift");
  });

  it("sends after moving 25m and 8s", () => {
    const previous = { latitude: base.latitude, longitude: base.longitude, sentAt: 1_000 };
    const result = decideSend(
      previous,
      { ...base, latitude: offsetMeters(30), recordedAt: 9_500 },
      9_500,
    );

    expect(result.send).toBe(true);
    expect(result.reason).toBe("moved");
  });

  it("does not send movement before the 8s window", () => {
    const previous = { latitude: base.latitude, longitude: base.longitude, sentAt: 1_000 };
    const result = decideSend(
      previous,
      { ...base, latitude: offsetMeters(80), recordedAt: 5_000 },
      5_000,
    );

    expect(result.send).toBe(false);
    expect(result.reason).toBe("not_time");
  });

  it("sends on the 20s base interval even with small movement", () => {
    const previous = { latitude: base.latitude, longitude: base.longitude, sentAt: 1_000 };
    const result = decideSend(
      previous,
      { ...base, latitude: offsetMeters(12), recordedAt: 23_000 },
      23_000,
    );

    expect(result.send).toBe(true);
    expect(result.reason).toBe("base");
  });

  it("sends a heartbeat after 60s standing still", () => {
    const previous = { latitude: base.latitude, longitude: base.longitude, sentAt: 1_000 };
    const result = decideSend(previous, { ...base, recordedAt: 62_000 }, 62_000);

    expect(result.send).toBe(true);
    expect(result.reason).toBe("heartbeat");
  });

  it("never sends an unusable fix", () => {
    const decision = decideSend(null, { ...base, accuracyMeters: 900 }, 1_000);
    expect(decision.send).toBe(false);
  });
});
