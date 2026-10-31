import {
  LOCATION_BASE_INTERVAL_MS,
  LOCATION_HEARTBEAT_MS,
  LOCATION_MIN_DRIFT_METERS,
  LOCATION_MIN_MOVEMENT_METERS,
  LOCATION_MOVED_INTERVAL_MS,
} from "./constants";
import {
  areValidCoordinates,
  haversineDistanceMeters,
  isAcceptableAccuracy,
  type Coordinates,
} from "./geo";

export type SentSample = Coordinates & {
  sentAt: number;
};

export type CandidateSample = Coordinates & {
  accuracyMeters: number;
};

export type TransmissionReason =
  "first" | "moved" | "interval" | "heartbeat" | "too_soon" | "imprecise" | "invalid";

export type TransmissionDecision = {
  send: boolean;
  reason: TransmissionReason;
  distanceMeters: number | null;
};

/**
 * Decides whether a GPS reading becomes a network write.
 *
 * - the first valid reading is always sent;
 * - movement above 25 m may be sent after 8 s;
 * - stationary devices send a heartbeat every 60 s;
 * - otherwise a reading is sent every 20 s only if it drifted at least 10 m;
 * - imprecise or invalid readings are dropped instead of stored.
 *
 * This is client-side economy, not a background guarantee: the browser may
 * suspend `watchPosition` when the page is hidden.
 */
export function decideLocationTransmission(input: {
  previous: SentSample | null;
  next: CandidateSample;
  now: number;
}): TransmissionDecision {
  const { previous, next, now } = input;

  if (!areValidCoordinates(next)) {
    return { send: false, reason: "invalid", distanceMeters: null };
  }

  if (!isAcceptableAccuracy(next.accuracyMeters)) {
    return { send: false, reason: "imprecise", distanceMeters: null };
  }

  if (!previous) {
    return { send: true, reason: "first", distanceMeters: null };
  }

  const distanceMeters = haversineDistanceMeters(previous, next);
  const elapsedMs = now - previous.sentAt;

  if (elapsedMs < LOCATION_MOVED_INTERVAL_MS) {
    return { send: false, reason: "too_soon", distanceMeters };
  }

  if (distanceMeters >= LOCATION_MIN_MOVEMENT_METERS) {
    return { send: true, reason: "moved", distanceMeters };
  }

  if (elapsedMs >= LOCATION_HEARTBEAT_MS) {
    return { send: true, reason: "heartbeat", distanceMeters };
  }

  if (elapsedMs >= LOCATION_BASE_INTERVAL_MS && distanceMeters >= LOCATION_MIN_DRIFT_METERS) {
    return { send: true, reason: "interval", distanceMeters };
  }

  return { send: false, reason: "too_soon", distanceMeters };
}
