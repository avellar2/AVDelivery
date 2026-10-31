package br.com.avdelivery.entregador;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class RpcClientTest {
    @Test
    public void readsErrorCodeBeforeDetail() {
        String body = "{\"code\":\"P0001\",\"details\":null,\"hint\":null,"
                + "\"message\":\"delivery_not_active|canceled\"}";

        RpcClient.Result result = RpcClient.Result.of(400, body);

        assertEquals("delivery_not_active", result.errorCode);
        assertTrue(result.isTerminal());
        assertFalse(result.changed);
    }

    @Test
    public void readsSuccessfulPayload() {
        String body = "{\"deliveryId\":\"abc\",\"changed\":true,"
                + "\"recordedAt\":\"2026-10-30T12:00:00Z\",\"updatedAt\":\"2026-10-30T12:00:01Z\"}";

        RpcClient.Result result = RpcClient.Result.of(200, body);

        assertTrue(result.changed);
        assertEquals("", result.errorCode);
        assertFalse(result.isTerminal());
    }

    @Test
    public void readsThrottleReason() {
        RpcClient.Result result = RpcClient.Result.of(
                200,
                "{\"changed\":false,\"reason\":\"rate_limited\",\"retryAfterSeconds\":5}"
        );

        assertTrue(result.isRateLimited());
        assertFalse(result.changed);
    }

    @Test
    public void flagsRevocationAndDiscardableCodes() {
        for (String code : new String[]{
                "delivery_completed", "delivery_not_active", "driver_inactive",
                "driver_not_member", "delivery_not_found", "forbidden"
        }) {
            assertTrue(code, RpcClient.Result.of(400, "{\"message\":\"" + code + "\"}").isTerminal());
        }

        for (String code : new String[]{
                "invalid_location", "invalid_coordinates", "invalid_accuracy",
                "invalid_timestamp", "stale_timestamp"
        }) {
            assertTrue(code, RpcClient.Result.of(400, "{\"message\":\"" + code + "\"}").isDiscardable());
        }
    }

    @Test
    public void transportFailureIsRetryable() {
        RpcClient.Result result = RpcClient.Result.transportFailure();

        assertTrue(result.transportError);
        assertFalse(result.isTerminal());
        assertFalse(result.isDiscardable());
    }

    @Test
    public void quotesJsonStrings() {
        assertEquals("\"a\\\"b\"", RpcClient.quote("a\"b"));
        assertEquals("\"a\\\\b\"", RpcClient.quote("a\\b"));
        assertEquals("\"a\\nb\"", RpcClient.quote("a\nb"));
    }

    @Test
    public void sampleSerializesRpcArgumentsWithoutSecrets() {
        LocationSample sample = new LocationSample(-23.5505d, -46.6333d, 12.5d, 1_700_000_000_000L);
        String json = sample.toRpcJson("delivery-1");

        assertTrue(json.contains("\"p_delivery_id\":\"delivery-1\""));
        assertTrue(json.contains("\"p_latitude\":-23.5505000"));
        assertTrue(json.contains("\"p_longitude\":-46.6333000"));
        assertTrue(json.contains("\"p_accuracy_meters\":12.5000000"));
        assertTrue(json.contains("\"p_recorded_at\":\"2023-11-14T22:13:20.000Z\""));
    }
}
