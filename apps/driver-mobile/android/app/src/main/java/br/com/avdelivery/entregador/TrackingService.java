package br.com.avdelivery.entregador;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Foreground service of type location. It owns the GPS subscription and posts
 * samples directly over HTTPS, so tracking survives the WebView being paused,
 * the screen being locked or another app coming to the front.
 */
public class TrackingService extends Service {
    public static final String ACTION_START = "br.com.avdelivery.entregador.action.START";
    public static final String ACTION_STOP = "br.com.avdelivery.entregador.action.STOP";

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_ANON_KEY = "anonKey";
    public static final String EXTRA_ACCESS_TOKEN = "accessToken";
    public static final String EXTRA_REFRESH_TOKEN = "refreshToken";
    public static final String EXTRA_EXPIRES_AT = "expiresAt";
    public static final String EXTRA_DELIVERY_ID = "deliveryId";
    public static final String EXTRA_USER_ID = "userId";

    private static final String CHANNEL_ID = "avd_delivery_tracking";
    private static final int NOTIFICATION_ID = 4211;
    private static final long RETRY_MIN_MS = 5_000L;
    private static final long RETRY_MAX_MS = 60_000L;
    private static final long RATE_LIMIT_RETRY_MS = 2_500L;

    private final RpcClient client = new RpcClient();
    private final SampleQueue queue = new SampleQueue();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean draining = new AtomicBoolean(false);
    private final Handler handler = new Handler(Looper.getMainLooper());

    private LocationManager locationManager;
    private LocationListener locationListener;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;
    private long retryDelayMs = RETRY_MIN_MS;
    private Runnable pendingRetry;

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        // A single listener instance is reused for every subscription. Creating
        // a new lambda on each retry would leave the previous registration
        // active and deliver duplicated fixes.
        locationListener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                onLocation(location);
            }

            @Override
            public void onProviderEnabled(String provider) {
                handler.post(TrackingService.this::onProvidersChanged);
            }

            @Override
            public void onProviderDisabled(String provider) {
                handler.post(TrackingService.this::onProvidersChanged);
            }
        };
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            // A restarted process has no session in memory; never resume blindly.
            stopSelf();
            return START_NOT_STICKY;
        }

        String action = intent.getAction();

        if (ACTION_STOP.equals(action)) {
            stopTracking();
            return START_NOT_STICKY;
        }

        if (!ACTION_START.equals(action)) {
            return START_NOT_STICKY;
        }

        String url = intent.getStringExtra(EXTRA_URL);
        String anonKey = intent.getStringExtra(EXTRA_ANON_KEY);
        String accessToken = intent.getStringExtra(EXTRA_ACCESS_TOKEN);
        String refreshToken = intent.getStringExtra(EXTRA_REFRESH_TOKEN);
        String deliveryId = intent.getStringExtra(EXTRA_DELIVERY_ID);
        String userId = intent.getStringExtra(EXTRA_USER_ID);
        long expiresAt = intent.getLongExtra(EXTRA_EXPIRES_AT, 0L);

        if (url == null || anonKey == null || accessToken == null
                || refreshToken == null || deliveryId == null) {
            TrackingRuntime.fail("Configuração de rastreamento incompleta.");
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!hasLocationPermission()) {
            TrackingRuntime.fail("Permissão de localização removida. Autorize novamente.");
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!startForegroundWithNotification(deliveryId)) {
            return START_NOT_STICKY;
        }

        TrackingRuntime.begin(url, anonKey, accessToken, refreshToken, expiresAt, deliveryId, userId);
        registerNetworkCallback();

        if (!startLocationUpdates()) {
            handler.postDelayed(this::retryProviders, 15_000L);
        }

        return START_NOT_STICKY;
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION)
                == android.content.pm.PackageManager.PERMISSION_GRANTED
                || ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_COARSE_LOCATION)
                == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager = getSystemService(NotificationManager.class);

        if (manager == null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Rastreamento de entrega",
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Mantém o envio da posição durante a entrega em rota.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private boolean startForegroundWithNotification(String deliveryId) {
        Notification notification = buildNotification(deliveryId);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                        NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                );
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }

            return true;
        } catch (RuntimeException error) {
            // SecurityException (permission revoked) and
            // MissingForegroundServiceTypeException both derive from
            // RuntimeException; without a foreground notification the service
            // would be killed on Android 12+, so fail explicitly.
            TrackingRuntime.fail("Não foi possível manter o rastreamento em primeiro plano.");
            stopSelf();
            return false;
        }
    }

    private Notification buildNotification(String deliveryId) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPending = PendingIntent.getActivity(
                this,
                0,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent stopIntent = new Intent(this, TrackingService.class).setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(
                this,
                1,
                stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("AVDelivery · Entregador")
                .setContentText("Compartilhando localização da entrega em rota")
                .setSmallIcon(R.drawable.ic_stat_tracking)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(openPending)
                .addAction(0, "Parar", stopPending);

        if (deliveryId != null) {
            builder.setSubText("Entrega em andamento");
        }

        return builder.build();
    }

    private boolean startLocationUpdates() {
        if (locationManager == null) {
            locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        }

        if (locationManager == null || locationListener == null) {
            TrackingRuntime.setState(TrackingRuntime.STATE_STARTING, "Serviço de localização indisponível.");
            return false;
        }

        if (!hasLocationPermission()) {
            TrackingRuntime.fail("Permissão de localização removida. Autorize novamente.");
            handler.post(this::shutdown);
            return false;
        }

        try {
            // Replace any previous subscription so retries and provider
            // toggles never leave duplicate listeners behind.
            locationManager.removeUpdates(locationListener);
        } catch (SecurityException ignored) {
            // Permission revoked; the checks below will fail as well.
        }

        boolean requested = false;

        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER, 1_000L, 0f, locationListener, Looper.getMainLooper());
                requested = true;
            }
        } catch (SecurityException | IllegalArgumentException ignored) {
            // Permission was revoked or the provider disappeared.
        }

        try {
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER, 2_000L, 0f, locationListener, Looper.getMainLooper());
                requested = true;
            }
        } catch (SecurityException | IllegalArgumentException ignored) {
            // Network provider is optional; GPS remains the primary source.
        }

        if (!requested) {
            TrackingRuntime.setState(
                    TrackingRuntime.STATE_STARTING,
                    "Ative a localização do aparelho para continuar compartilhando."
            );
            return false;
        }

        if (TrackingRuntime.STATE_STARTING.equals(TrackingRuntime.getState())) {
            TrackingRuntime.setState(TrackingRuntime.STATE_STARTING, "Aguardando sinal de GPS…");
        }

        return true;
    }

    /**
     * Reacts to the user turning location off/on. The service keeps running so
     * the notification and the queue survive; only the fix source pauses.
     */
    private void onProvidersChanged() {
        if (!TrackingRuntime.isRunning() || locationManager == null) {
            return;
        }

        boolean gps;
        boolean network;

        try {
            gps = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER);
            network = locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (RuntimeException error) {
            gps = false;
            network = false;
        }

        if (!gps && !network) {
            TrackingRuntime.setState(
                    TrackingRuntime.STATE_STARTING,
                    "Localização desativada. Ative o GPS para continuar compartilhando."
            );
            return;
        }

        startLocationUpdates();
    }

    private void registerNetworkCallback() {
        if (networkCallback != null) {
            return;
        }

        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);

        if (connectivityManager == null) {
            return;
        }

        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                handler.post(TrackingService.this::onNetworkAvailable);
            }
        };

        try {
            connectivityManager.registerDefaultNetworkCallback(networkCallback);
        } catch (RuntimeException error) {
            networkCallback = null;
        }
    }

    private void unregisterNetworkCallback() {
        if (networkCallback == null || connectivityManager == null) {
            networkCallback = null;
            return;
        }

        try {
            connectivityManager.unregisterNetworkCallback(networkCallback);
        } catch (RuntimeException ignored) {
            // Already unregistered by the system.
        }

        networkCallback = null;
    }

    /**
     * Reconnection is the fastest path out of the offline state: clear the
     * backoff and try the queue immediately instead of waiting up to 60 s.
     */
    private void onNetworkAvailable() {
        if (!TrackingRuntime.isRunning()) {
            return;
        }

        retryDelayMs = RETRY_MIN_MS;
        // A short delay lets any in-flight drain finish; the single-flight
        // guard would otherwise swallow this attempt.
        handler.postDelayed(this::drain, 300L);
    }

    private void retryProviders() {
        if (!TrackingRuntime.isRunning()) {
            return;
        }

        if (!startLocationUpdates()) {
            handler.postDelayed(this::retryProviders, 15_000L);
        }
    }

    private void onLocation(Location location) {
        if (!TrackingRuntime.isRunning() || location == null) {
            return;
        }

        double latitude = location.getLatitude();
        double longitude = location.getLongitude();
        double accuracy = location.hasAccuracy() ? location.getAccuracy() : 999d;
        long now = System.currentTimeMillis();
        long recordedAt = location.getTime();

        if (recordedAt <= 0L || recordedAt > now + 60_000L) {
            // A missing or future-dated fix is timestamped with the device
            // clock; the server rejects timestamps beyond +1 minute.
            recordedAt = now;
        }

        if (!LocationThrottle.isFresh(recordedAt, now)) {
            return;
        }

        if (!LocationThrottle.isUsableFix(latitude, longitude, accuracy)) {
            return;
        }

        boolean shouldSend = LocationThrottle.shouldSend(
                TrackingRuntime.hasPreviousFix(),
                TrackingRuntime.getLastLatitude(),
                TrackingRuntime.getLastLongitude(),
                TrackingRuntime.getLastSentAt(),
                latitude,
                longitude,
                accuracy,
                now
        );

        if (!shouldSend) {
            return;
        }

        // The queue keeps the original fix time, so an offline batch replays
        // with the real collection instant instead of the flush instant.
        queue.enqueue(new LocationSample(latitude, longitude, accuracy, recordedAt), now);
        TrackingRuntime.setQueued(queue.size());
        drain();
    }

    private void drain() {
        if (!draining.compareAndSet(false, true)) {
            return;
        }

        executor.execute(() -> {
            try {
                boolean refreshed = false;

                while (TrackingRuntime.isRunning()) {
                    LocationSample sample = queue.peek();

                    if (sample == null) {
                        TrackingRuntime.setQueued(0);
                        return;
                    }

                    if (TrackingRuntime.needsRefresh() && !refreshSession()) {
                        terminate("Sessão expirada. Abra o aplicativo e entre novamente.");
                        return;
                    }

                    RpcClient.Result result = client.shareLocation(
                            TrackingRuntime.getBaseUrl(),
                            TrackingRuntime.getAnonKey(),
                            TrackingRuntime.getAccessToken(),
                            TrackingRuntime.getDeliveryId(),
                            sample
                    );

                    if (result.transportError || result.status == 429 || result.status >= 500) {
                        TrackingRuntime.setQueued(queue.size());
                        TrackingRuntime.setOffline("Sem conexão. Amostras ficam na fila.");
                        scheduleRetry(retryDelayMs);
                        return;
                    }

                    if (result.status == 401) {
                        if (refreshed || !refreshSession()) {
                            terminate("Sessão expirada. Abra o aplicativo e entre novamente.");
                            return;
                        }

                        refreshed = true;
                        continue;
                    }

                    if (result.status >= 200 && result.status < 300) {
                        if (result.isRateLimited()) {
                            // Server throttle is not a network failure: keep
                            // the network backoff unchanged.
                            scheduleRetry(RATE_LIMIT_RETRY_MS, false);
                            return;
                        }

                        queue.pop();
                        TrackingRuntime.setQueued(queue.size());

                        if (!result.isOutOfOrder()) {
                            TrackingRuntime.recordSent(sample);
                        }

                        retryDelayMs = RETRY_MIN_MS;
                        continue;
                    }

                    if (result.isTerminal()) {
                        terminate(terminalMessage(result.errorCode));
                        return;
                    }

                    // Invalid or unexpected payloads are dropped so one bad
                    // sample cannot block the rest of the queue.
                    queue.pop();
                    TrackingRuntime.setQueued(queue.size());
                }
            } finally {
                draining.set(false);
            }
        });
    }

    private boolean refreshSession() {
        RpcClient.Session session = client.refreshSession(
                TrackingRuntime.getBaseUrl(),
                TrackingRuntime.getAnonKey(),
                TrackingRuntime.getRefreshToken()
        );

        if (!session.ok) {
            return false;
        }

        TrackingRuntime.updateSession(session.accessToken, session.refreshToken, session.expiresAt);
        return true;
    }

    private void scheduleRetry(long delayMs) {
        scheduleRetry(delayMs, true);
    }

    private void scheduleRetry(long delayMs, boolean escalate) {
        if (pendingRetry != null) {
            handler.removeCallbacks(pendingRetry);
        }

        pendingRetry = () -> {
            pendingRetry = null;

            if (TrackingRuntime.isRunning()) {
                drain();
            }
        };

        handler.postDelayed(pendingRetry, delayMs);

        if (escalate) {
            retryDelayMs = Math.min(RETRY_MAX_MS, retryDelayMs * 2);
        }
    }

    private void terminate(String message) {
        TrackingRuntime.fail(message);
        handler.post(this::shutdown);
    }

    private String terminalMessage(String code) {
        switch (code) {
            case "delivery_completed":
                return "Entrega concluída. Compartilhamento encerrado.";
            case "delivery_not_active":
                return "Entrega cancelada ou reatribuída. Compartilhamento encerrado.";
            case "driver_inactive":
            case "driver_not_member":
            case "forbidden":
                return "Seu acesso a esta entrega foi revogado.";
            case "delivery_not_found":
                return "Entrega não encontrada.";
            default:
                return "A entrega não está mais em rota.";
        }
    }

    private void stopTracking() {
        TrackingRuntime.stop();
        queue.clear();
        shutdown();
    }

    private void shutdown() {
        if (locationManager != null && locationListener != null) {
            try {
                locationManager.removeUpdates(locationListener);
            } catch (SecurityException ignored) {
                // Permission already revoked; nothing left to unsubscribe.
            }
        }

        if (pendingRetry != null) {
            handler.removeCallbacks(pendingRetry);
            pendingRetry = null;
        }

        unregisterNetworkCallback();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }

        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (locationManager != null && locationListener != null) {
            try {
                locationManager.removeUpdates(locationListener);
            } catch (SecurityException ignored) {
                // Nothing else to remove.
            }
        }

        handler.removeCallbacksAndMessages(null);
        unregisterNetworkCallback();
        executor.shutdownNow();

        if (TrackingRuntime.isRunning()) {
            TrackingRuntime.stop();
        }

        super.onDestroy();
    }
}
