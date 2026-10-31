package br.com.avdelivery.entregador;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Minimal HTTPS client used by the foreground service. It talks straight to
 * the Supabase REST/RPC endpoints so location updates never depend on the
 * WebView, which Android throttles after a few minutes in the background.
 *
 * No coordinate or token value is ever written to logcat.
 */
public final class RpcClient {
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 15_000;

    private static final Pattern MESSAGE_PATTERN =
            Pattern.compile("\"message\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
    private static final Pattern STRING_PATTERN =
            Pattern.compile("\"([A-Za-z0-9_]+)\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
    private static final Pattern BOOLEAN_PATTERN =
            Pattern.compile("\"([A-Za-z0-9_]+)\"\\s*:\\s*(true|false)");
    private static final Pattern LONG_PATTERN =
            Pattern.compile("\"([A-Za-z0-9_]+)\"\\s*:\\s*(-?\\d+)");

    public RpcClient() {}

    public static final class Result {
        public final int status;
        public final String errorCode;
        public final boolean changed;
        public final String reason;
        public final boolean transportError;

        private Result(int status, String errorCode, boolean changed, String reason, boolean transportError) {
            this.status = status;
            this.errorCode = errorCode;
            this.changed = changed;
            this.reason = reason;
            this.transportError = transportError;
        }

        public static Result of(int status, String body) {
            String message = extractMessage(body);
            String errorCode = message.isEmpty() ? "" : message.split("\\|", 2)[0].trim();
            return new Result(
                    status,
                    errorCode,
                    extractBoolean(body, "changed"),
                    extractString(body, "reason"),
                    false
            );
        }

        public static Result transportFailure() {
            return new Result(0, "", false, "", true);
        }

        public boolean isRateLimited() {
            return "rate_limited".equals(reason);
        }

        public boolean isOutOfOrder() {
            return "out_of_order".equals(reason);
        }

        public boolean isTerminal() {
            switch (errorCode) {
                case "delivery_completed":
                case "delivery_not_active":
                case "driver_inactive":
                case "driver_not_member":
                case "delivery_not_found":
                case "forbidden":
                case "order_not_out_for_delivery":
                case "order_not_available":
                    return true;
                default:
                    return false;
            }
        }

        public boolean isDiscardable() {
            switch (errorCode) {
                case "invalid_location":
                case "invalid_coordinates":
                case "invalid_accuracy":
                case "invalid_timestamp":
                case "stale_timestamp":
                    return true;
                default:
                    return false;
            }
        }
    }

    public static final class Session {
        public final boolean ok;
        public final String accessToken;
        public final String refreshToken;
        public final long expiresAt;

        private Session(boolean ok, String accessToken, String refreshToken, long expiresAt) {
            this.ok = ok;
            this.accessToken = accessToken;
            this.refreshToken = refreshToken;
            this.expiresAt = expiresAt;
        }

        public static Session failure() {
            return new Session(false, null, null, 0L);
        }
    }

    public Result shareLocation(
            String baseUrl,
            String anonKey,
            String accessToken,
            String deliveryId,
            LocationSample sample
    ) {
        HttpURLConnection connection = null;

        try {
            URL url = new URL(trimSlash(baseUrl) + "/rest/v1/rpc/share_delivery_location");
            connection = open(url, accessToken, anonKey);
            write(connection, sample.toRpcJson(deliveryId));

            int status = connection.getResponseCode();
            String body = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
            return Result.of(status, body);
        } catch (IOException | RuntimeException error) {
            return Result.transportFailure();
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    public Session refreshSession(String baseUrl, String anonKey, String refreshToken) {
        HttpURLConnection connection = null;

        try {
            URL url = new URL(trimSlash(baseUrl) + "/auth/v1/token?grant_type=refresh_token");
            connection = open(url, null, anonKey);
            write(connection, "{\"refresh_token\":" + quote(refreshToken) + "}");

            int status = connection.getResponseCode();

            if (status < 200 || status >= 300) {
                return Session.failure();
            }

            String body = read(connection.getInputStream());
            String access = extractString(body, "access_token");
            String refresh = extractString(body, "refresh_token");
            long expiresIn = extractLong(body, "expires_in");

            if (access.isEmpty() || refresh.isEmpty()) {
                return Session.failure();
            }

            long expiresAt = expiresIn > 0 ? System.currentTimeMillis() + expiresIn * 1000L : 0L;
            return new Session(true, access, refresh, expiresAt);
        } catch (IOException | RuntimeException error) {
            return Session.failure();
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static HttpURLConnection open(URL url, String accessToken, String anonKey) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setInstanceFollowRedirects(false);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("apikey", anonKey);

        if (accessToken != null) {
            connection.setRequestProperty("Authorization", "Bearer " + accessToken);
        }

        return connection;
    }

    private static void write(HttpURLConnection connection, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);

        try (OutputStream output = connection.getOutputStream()) {
            output.write(bytes);
        }
    }

    private static String read(InputStream stream) throws IOException {
        if (stream == null) {
            return "";
        }

        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int read;

            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }

            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static String trimSlash(String value) {
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }

    public static String quote(String value) {
        StringBuilder builder = new StringBuilder("\"");

        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);

            switch (character) {
                case '"':
                    builder.append("\\\"");
                    break;
                case '\\':
                    builder.append("\\\\");
                    break;
                case '\n':
                    builder.append("\\n");
                    break;
                case '\r':
                    builder.append("\\r");
                    break;
                case '\t':
                    builder.append("\\t");
                    break;
                default:
                    if (character < 0x20) {
                        builder.append(String.format("\\u%04x", (int) character));
                    } else {
                        builder.append(character);
                    }
            }
        }

        return builder.append('"').toString();
    }

    public static String extractMessage(String body) {
        if (body == null) {
            return "";
        }

        Matcher matcher = MESSAGE_PATTERN.matcher(body);
        return matcher.find() ? unescape(matcher.group(1)) : "";
    }

    public static String extractString(String body, String key) {
        if (body == null) {
            return "";
        }

        Matcher matcher = STRING_PATTERN.matcher(body);

        while (matcher.find()) {
            if (key.equals(matcher.group(1))) {
                return unescape(matcher.group(2));
            }
        }

        return "";
    }

    public static boolean extractBoolean(String body, String key) {
        if (body == null) {
            return false;
        }

        Matcher matcher = BOOLEAN_PATTERN.matcher(body);

        while (matcher.find()) {
            if (key.equals(matcher.group(1))) {
                return Boolean.parseBoolean(matcher.group(2));
            }
        }

        return false;
    }

    public static long extractLong(String body, String key) {
        if (body == null) {
            return 0L;
        }

        Matcher matcher = LONG_PATTERN.matcher(body);

        while (matcher.find()) {
            if (key.equals(matcher.group(1))) {
                try {
                    return Long.parseLong(matcher.group(2));
                } catch (NumberFormatException ignored) {
                    return 0L;
                }
            }
        }

        return 0L;
    }

    private static String unescape(String value) {
        StringBuilder builder = new StringBuilder(value.length());

        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);

            if (character != '\\' || index + 1 >= value.length()) {
                builder.append(character);
                continue;
            }

            char next = value.charAt(++index);

            switch (next) {
                case 'n':
                    builder.append('\n');
                    break;
                case 'r':
                    builder.append('\r');
                    break;
                case 't':
                    builder.append('\t');
                    break;
                case 'u':
                    if (index + 4 < value.length()) {
                        try {
                            builder.append((char) Integer.parseInt(value.substring(index + 1, index + 5), 16));
                            index += 4;
                        } catch (NumberFormatException ignored) {
                            builder.append("\\u");
                        }
                    } else {
                        builder.append("\\u");
                    }
                    break;
                default:
                    builder.append(next);
            }
        }

        return builder.toString();
    }
}
