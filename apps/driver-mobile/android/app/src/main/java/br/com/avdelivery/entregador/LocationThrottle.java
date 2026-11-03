package br.com.avdelivery.entregador;

/**
 * Sample cadence shared with the web panel. Keep these numbers in sync with
 * apps/driver-mobile/src/lib/tracking-policy.ts.
 */
public final class LocationThrottle {
    public static final long MOVED_INTERVAL_MS = 8_000L;
    public static final long BASE_INTERVAL_MS = 20_000L;
    public static final long HEARTBEAT_MS = 60_000L;
    public static final double MIN_MOVEMENT_METERS = 25d;
    public static final double MIN_DRIFT_METERS = 10d;
    public static final double MAX_ACCURACY_METERS = 150d;
    /** Fixes older than this are discarded instead of sent as if current. */
    public static final long MAX_FIX_AGE_MS = 120_000L;

    private static final double EARTH_RADIUS_METERS = 6_371_000d;

    private LocationThrottle() {}

    public static double distanceMeters(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1d, Math.sqrt(a)));
    }

    public static boolean isUsableFix(double latitude, double longitude, double accuracyMeters) {
        if (Double.isNaN(latitude) || Double.isNaN(longitude) || Double.isNaN(accuracyMeters)) {
            return false;
        }
        if (latitude < -90d || latitude > 90d || longitude < -180d || longitude > 180d) {
            return false;
        }
        return accuracyMeters > 0d && accuracyMeters <= MAX_ACCURACY_METERS;
    }

    public static boolean isFresh(long recordedAt, long now) {
        if (recordedAt <= 0L) {
            return false;
        }

        long age = now - recordedAt;

        // A fix slightly ahead of the device clock is accepted; older than the
        // limit is dropped so a stale cached location never overwrites a
        // recent one on the server.
        return age <= MAX_FIX_AGE_MS && age >= -60_000L;
    }

    public static boolean shouldSend(
            boolean hasPrevious,
            double previousLatitude,
            double previousLongitude,
            long previousSentAt,
            double latitude,
            double longitude,
            double accuracyMeters,
            long now
    ) {
        if (!isUsableFix(latitude, longitude, accuracyMeters)) {
            return false;
        }

        if (!hasPrevious) {
            return true;
        }

        double distance = distanceMeters(previousLatitude, previousLongitude, latitude, longitude);
        long elapsed = Math.max(0L, now - previousSentAt);

        if (distance < MIN_DRIFT_METERS && elapsed < HEARTBEAT_MS) {
            return false;
        }

        if (elapsed >= HEARTBEAT_MS) {
            return true;
        }

        if (elapsed >= MOVED_INTERVAL_MS && distance >= MIN_MOVEMENT_METERS) {
            return true;
        }

        return elapsed >= BASE_INTERVAL_MS;
    }
}
