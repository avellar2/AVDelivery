package br.com.avdelivery.entregador;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public final class LocationSample {
    private final double latitude;
    private final double longitude;
    private final double accuracyMeters;
    private final long recordedAt;

    public LocationSample(double latitude, double longitude, double accuracyMeters, long recordedAt) {
        this.latitude = latitude;
        this.longitude = longitude;
        this.accuracyMeters = accuracyMeters;
        this.recordedAt = recordedAt;
    }

    public double getLatitude() {
        return latitude;
    }

    public double getLongitude() {
        return longitude;
    }

    public double getAccuracyMeters() {
        return accuracyMeters;
    }

    public long getRecordedAt() {
        return recordedAt;
    }

    public String recordedAtIso() {
        SimpleDateFormat format =
                new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(recordedAt));
    }

    public String toRpcJson(String deliveryId) {
        return "{"
                + "\"p_delivery_id\":" + RpcClient.quote(deliveryId) + ","
                + "\"p_latitude\":" + formatNumber(latitude) + ","
                + "\"p_longitude\":" + formatNumber(longitude) + ","
                + "\"p_accuracy_meters\":" + formatNumber(accuracyMeters) + ","
                + "\"p_recorded_at\":" + RpcClient.quote(recordedAtIso())
                + "}";
    }

    private static String formatNumber(double value) {
        return String.format(Locale.US, "%.7f", value);
    }
}
