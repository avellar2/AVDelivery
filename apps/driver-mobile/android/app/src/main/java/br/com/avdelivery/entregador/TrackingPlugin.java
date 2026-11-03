package br.com.avdelivery.entregador;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.location.LocationManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;

/**
 * Bridges the WebView to the native foreground service. Tokens are handed to
 * the service in memory at each start and never persisted natively.
 */
@CapacitorPlugin(
        name = "DriverTracking",
        permissions = {
                @Permission(
                        alias = "location",
                        strings = {
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION
                        }
                ),
                @Permission(
                        alias = "notifications",
                        strings = {Manifest.permission.POST_NOTIFICATIONS}
                )
        }
)
public class TrackingPlugin extends Plugin {
    @Override
    public void load() {
        TrackingRuntime.setObserver(() -> {
            try {
                notifyListeners("status", snapshot(), true);
            } catch (JSONException ignored) {
                // Snapshot only contains primitives.
            }
        });

        notifyListeners("status", snapshotQuietly(), true);
    }

    @PluginMethod
    public void start(PluginCall call) {
        String url = call.getString("url");
        String anonKey = call.getString("anonKey");
        String accessToken = call.getString("accessToken");
        String refreshToken = call.getString("refreshToken");
        String deliveryId = call.getString("deliveryId");
        String userId = call.getString("userId", "");
        Long expiresAt = call.getLong("expiresAt", 0L);

        if (url == null || anonKey == null || accessToken == null
                || refreshToken == null || deliveryId == null) {
            call.reject("Configuração de rastreamento incompleta.");
            return;
        }

        if (!url.startsWith("https://")) {
            call.reject("A URL do rastreamento precisa usar HTTPS.");
            return;
        }

        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Permissão de localização não concedida.");
            return;
        }

        if (!isLocationEnabled()) {
            call.reject("Ative a localização do aparelho para compartilhar a entrega.");
            return;
        }

        Intent intent = new Intent(getContext(), TrackingService.class)
                .setAction(TrackingService.ACTION_START)
                .putExtra(TrackingService.EXTRA_URL, url)
                .putExtra(TrackingService.EXTRA_ANON_KEY, anonKey)
                .putExtra(TrackingService.EXTRA_ACCESS_TOKEN, accessToken)
                .putExtra(TrackingService.EXTRA_REFRESH_TOKEN, refreshToken)
                .putExtra(TrackingService.EXTRA_EXPIRES_AT, expiresAt == null ? 0L : expiresAt)
                .putExtra(TrackingService.EXTRA_DELIVERY_ID, deliveryId)
                .putExtra(TrackingService.EXTRA_USER_ID, userId);

        try {
            ContextCompat.startForegroundService(getContext(), intent);
        } catch (RuntimeException error) {
            // ForegroundServiceStartNotAllowedException (Android 12+) means the
            // app was not visible; starting in the background is not allowed
            // without ACCESS_BACKGROUND_LOCATION, which this app deliberately
            // does not request.
            String errorName = error.getClass().getSimpleName();

            if ("ForegroundServiceStartNotAllowedException".equals(errorName)) {
                call.reject("Mantenha o aplicativo aberto para iniciar o compartilhamento.");
            } else if (error instanceof SecurityException) {
                call.reject("Permissão de localização removida. Autorize novamente.");
            } else {
                call.reject("Não foi possível iniciar o serviço de localização.");
            }

            return;
        }

        call.resolve(snapshotQuietly());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();

        if (TrackingRuntime.isRunning()) {
            Intent intent = new Intent(context, TrackingService.class)
                    .setAction(TrackingService.ACTION_STOP);
            context.startService(intent);
        } else {
            TrackingRuntime.stop();
        }

        call.resolve(snapshotQuietly());
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(snapshotQuietly());
    }

    @PluginMethod
    public void updateSession(PluginCall call) {
        String accessToken = call.getString("accessToken");
        String refreshToken = call.getString("refreshToken");
        Long expiresAt = call.getLong("expiresAt", 0L);

        if (accessToken == null || refreshToken == null) {
            call.reject("Sessão inválida.");
            return;
        }

        if (TrackingRuntime.isRunning()) {
            TrackingRuntime.updateSession(
                    accessToken,
                    refreshToken,
                    expiresAt == null ? 0L : expiresAt
            );
        }

        call.resolve();
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }

        requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(result);
    }

    private boolean isLocationEnabled() {
        LocationManager manager =
                (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);

        if (manager == null) {
            return false;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return manager.isLocationEnabled();
        }

        try {
            return manager.isProviderEnabled(LocationManager.GPS_PROVIDER)
                    || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (RuntimeException error) {
            return false;
        }
    }

    private JSObject snapshotQuietly() {
        try {
            return snapshot();
        } catch (JSONException error) {
            return new JSObject();
        }
    }

    private JSObject snapshot() throws JSONException {
        return new JSObject(TrackingRuntime.snapshot().toString());
    }
}
