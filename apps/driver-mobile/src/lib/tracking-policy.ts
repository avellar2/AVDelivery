/**
 * Sample policy shared by the web fallback and the Android foreground service.
 * The Kotlin implementation mirrors these numbers, so the app keeps the same
 * cadence whether it is running in a browser or with the native service.
 */
export const TRACKING_POLICY = {
  movedIntervalMs: 8_000,
  baseIntervalMs: 20_000,
  heartbeatMs: 60_000,
  minMovementMeters: 25,
  minDriftMeters: 10,
  maxAccuracyMeters: 150,
  maxQueueSize: 60,
  queueMaxAgeMs: 15 * 60_000,
} as const;

export type GeoFix = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  recordedAt: number;
};

export type PreviousSent = {
  latitude: number;
  longitude: number;
  sentAt: number;
};

export function isUsableFix(fix: GeoFix): boolean {
  if (!Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) {
    return false;
  }

  if (fix.latitude < -90 || fix.latitude > 90) {
    return false;
  }

  if (fix.longitude < -180 || fix.longitude > 180) {
    return false;
  }

  return (
    Number.isFinite(fix.accuracyMeters) &&
    fix.accuracyMeters > 0 &&
    fix.accuracyMeters <= TRACKING_POLICY.maxAccuracyMeters
  );
}

/** Haversine distance in meters. */
export function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const earthRadius = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type SendDecision = {
  send: boolean;
  reason: "first" | "moved" | "base" | "heartbeat" | "drift" | "not_time" | "unchanged";
  distance: number;
};

export function decideSend(
  previous: PreviousSent | null,
  fix: GeoFix,
  now: number,
): SendDecision {
  if (!isUsableFix(fix)) {
    return { send: false, reason: "drift", distance: 0 };
  }

  if (!previous) {
    return { send: true, reason: "first", distance: 0 };
  }

  const distance = distanceMeters(previous, fix);
  const elapsed = now - previous.sentAt;

  if (distance < TRACKING_POLICY.minDriftMeters && elapsed < TRACKING_POLICY.heartbeatMs) {
    return { send: false, reason: "drift", distance };
  }

  if (elapsed >= TRACKING_POLICY.heartbeatMs) {
    return { send: true, reason: "heartbeat", distance };
  }

  if (elapsed >= TRACKING_POLICY.movedIntervalMs && distance >= TRACKING_POLICY.minMovementMeters) {
    return { send: true, reason: "moved", distance };
  }

  if (elapsed >= TRACKING_POLICY.baseIntervalMs) {
    return { send: true, reason: "base", distance };
  }

  return {
    send: false,
    reason: distance < TRACKING_POLICY.minDriftMeters ? "unchanged" : "not_time",
    distance,
  };
}
