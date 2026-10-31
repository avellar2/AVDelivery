package br.com.avdelivery.entregador;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * In-process state shared by the plugin and the foreground service. Session
 * tokens live only in memory: they are never persisted to disk by the native
 * layer, so uninstalling or clearing the app removes them.
 */
public final class TrackingRuntime {
    public static final String STATE_IDLE = "idle";
    public static final String STATE_STARTING = "starting";
    public static final String STATE_TRACKING = "tracking";
    public static final String STATE_OFFLINE = "offline";
    public static final String STATE_ERROR = "error";
    public static final String STATE_STOPPED = "stopped";

    private static final Object LOCK = new Object();

    private static volatile Runnable observer;

    private static String baseUrl;
    private static String anonKey;
    private static String accessToken;
    private static String refreshToken;
    private static long expiresAt;
    private static String deliveryId;
    private static String userId;

    private static volatile boolean running;
    private static volatile String state = STATE_IDLE;
    private static volatile String message;
    private static volatile long lastSentAt;
    private static volatile double lastLatitude = Double.NaN;
    private static volatile double lastLongitude = Double.NaN;
    private static volatile double lastAccuracy = Double.NaN;
    private static volatile int queued;
    private static volatile int sentCount;

    private TrackingRuntime() {}

    public static void setObserver(Runnable value) {
        observer = value;
    }

    public static void emit() {
        Runnable current = observer;

        if (current != null) {
            try {
                current.run();
            } catch (RuntimeException ignored) {
                // The WebView can be destroyed while the service keeps running.
            }
        }
    }

    public static void begin(
            String url,
            String apiKey,
            String access,
            String refresh,
            long tokenExpiresAt,
            String trackingDeliveryId,
            String trackingUserId
    ) {
        synchronized (LOCK) {
            baseUrl = url;
            anonKey = apiKey;
            accessToken = access;
            refreshToken = refresh;
            expiresAt = tokenExpiresAt;
            deliveryId = trackingDeliveryId;
            userId = trackingUserId;
            running = true;
            state = STATE_STARTING;
            message = "Iniciando o serviço de localização…";
            lastSentAt = 0L;
            lastLatitude = Double.NaN;
            lastLongitude = Double.NaN;
            lastAccuracy = Double.NaN;
            queued = 0;
            sentCount = 0;
        }

        emit();
    }

    public static boolean isRunning() {
        return running;
    }

    public static String getState() {
        return state;
    }

    public static String getDeliveryId() {
        return deliveryId;
    }

    public static String getBaseUrl() {
        return baseUrl;
    }

    public static String getAnonKey() {
        return anonKey;
    }

    public static String getAccessToken() {
        return accessToken;
    }

    public static String getRefreshToken() {
        return refreshToken;
    }

    public static long getExpiresAt() {
        return expiresAt;
    }

    public static boolean needsRefresh() {
        long expiration = expiresAt;
        return expiration > 0 && System.currentTimeMillis() >= expiration - 60_000L;
    }

    public static void updateSession(String access, String refresh, long tokenExpiresAt) {
        synchronized (LOCK) {
            accessToken = access;
            refreshToken = refresh;
            expiresAt = tokenExpiresAt;
        }

        emit();
    }

    public static void setState(String nextState, String nextMessage) {
        state = nextState;
        message = nextMessage;
        emit();
    }

    public static void setQueued(int size) {
        queued = size;
    }

    public static void recordSent(LocationSample sample) {
        lastSentAt = System.currentTimeMillis();
        lastLatitude = sample.getLatitude();
        lastLongitude = sample.getLongitude();
        lastAccuracy = sample.getAccuracyMeters();
        sentCount = sentCount + 1;
        state = STATE_TRACKING;
        message = "Compartilhando localização em primeiro plano.";
        emit();
    }

    public static void recordQueued() {
        queued = queued + 1;
    }

    public static void setOffline(String reason) {
        state = STATE_OFFLINE;
        message = reason;
        emit();
    }

    public static void fail(String reason) {
        running = false;
        state = STATE_ERROR;
        message = reason;
        queued = 0;
        emit();
    }

    public static void stop() {
        synchronized (LOCK) {
            running = false;
            state = STATE_STOPPED;
            message = "Compartilhamento encerrado.";
            deliveryId = null;
            queued = 0;
            // Tokens stay in memory until the next start so the WebView can
            // adopt a refresh token rotated by the native service.
        }

        emit();
    }

    public static void resetIdle() {
        synchronized (LOCK) {
            running = false;
            state = STATE_IDLE;
            message = null;
            deliveryId = null;
            queued = 0;
            sentCount = 0;
            lastSentAt = 0L;
            lastLatitude = Double.NaN;
            lastLongitude = Double.NaN;
            lastAccuracy = Double.NaN;
            clearSession();
        }

        emit();
    }

    private static void clearSession() {
        accessToken = null;
        refreshToken = null;
        expiresAt = 0L;
    }

    public static JSONObject snapshot() {
        JSONObject payload = new JSONObject();

        try {
            payload.put("running", running);
            payload.put("deliveryId", deliveryId);
            payload.put("state", state);
            payload.put("message", message);
            payload.put("lastSentAt", lastSentAt > 0 ? lastSentAt : JSONObject.NULL);
            payload.put("lastLatitude", Double.isNaN(lastLatitude) ? JSONObject.NULL : lastLatitude);
            payload.put("lastLongitude", Double.isNaN(lastLongitude) ? JSONObject.NULL : lastLongitude);
            payload.put("lastAccuracy", Double.isNaN(lastAccuracy) ? JSONObject.NULL : lastAccuracy);
            payload.put("queued", queued);
            payload.put("sentCount", sentCount);

            if (accessToken != null) {
                payload.put("accessToken", accessToken);
                payload.put("refreshToken", refreshToken == null ? JSONObject.NULL : refreshToken);
                payload.put("expiresAt", expiresAt);
                payload.put("userId", userId == null ? JSONObject.NULL : userId);
            }
        } catch (JSONException ignored) {
            // Values above are primitives; the payload is always serializable.
        }

        return payload;
    }

    public static boolean hasPreviousFix() {
        return lastSentAt > 0;
    }

    public static double getLastLatitude() {
        return lastLatitude;
    }

    public static double getLastLongitude() {
        return lastLongitude;
    }

    public static long getLastSentAt() {
        return lastSentAt;
    }
}
