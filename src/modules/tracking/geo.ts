import { LOCATION_MAX_ACCURACY_METERS } from "./constants";

const EARTH_RADIUS_METERS = 6_371_000;

export type Coordinates = {
  latitude: number;
  longitude: number;
};

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function areValidCoordinates(value: Coordinates): boolean {
  return isValidLatitude(value.latitude) && isValidLongitude(value.longitude);
}

export function isAcceptableAccuracy(accuracyMeters: number): boolean {
  return (
    Number.isFinite(accuracyMeters) &&
    accuracyMeters > 0 &&
    accuracyMeters <= LOCATION_MAX_ACCURACY_METERS
  );
}

export function haversineDistanceMeters(from: Coordinates, to: Coordinates): number {
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);

  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(deltaLongitude / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}
