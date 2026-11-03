package br.com.avdelivery.entregador;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class LocationThrottleTest {
    private static final double LAT = -23.5505d;
    private static final double LNG = -46.6333d;

    private static double offsetMeters(double meters) {
        return LAT + meters / 111_320d;
    }

    @Test
    public void acceptsPlausibleFix() {
        assertTrue(LocationThrottle.isUsableFix(LAT, LNG, 12d));
    }

    @Test
    public void rejectsInvalidCoordinatesAndAccuracy() {
        assertFalse(LocationThrottle.isUsableFix(91d, LNG, 12d));
        assertFalse(LocationThrottle.isUsableFix(LAT, -181d, 12d));
        assertFalse(LocationThrottle.isUsableFix(LAT, LNG, 0d));
        assertFalse(LocationThrottle.isUsableFix(LAT, LNG, 151d));
        assertTrue(LocationThrottle.isUsableFix(LAT, LNG, 150d));
    }

    @Test
    public void distanceMatchesKnownLatitudeOffset() {
        assertEquals(0d, LocationThrottle.distanceMeters(LAT, LNG, LAT, LNG), 0.0001d);
        assertEquals(100d, LocationThrottle.distanceMeters(LAT, LNG, offsetMeters(100), LNG), 1d);
    }

    @Test
    public void sendsFirstFix() {
        assertTrue(LocationThrottle.shouldSend(false, 0, 0, 0, LAT, LNG, 10, 1_000L));
    }

    @Test
    public void skipsSmallDriftUnderSixtySeconds() {
        assertFalse(LocationThrottle.shouldSend(true, LAT, LNG, 1_000L, offsetMeters(3), LNG, 10, 12_000L));
    }

    @Test
    public void sendsMovementAfterEightSeconds() {
        assertTrue(LocationThrottle.shouldSend(true, LAT, LNG, 1_000L, offsetMeters(30), LNG, 10, 9_500L));
    }

    @Test
    public void doesNotSendMovementBeforeEightSeconds() {
        assertFalse(LocationThrottle.shouldSend(true, LAT, LNG, 1_000L, offsetMeters(80), LNG, 10, 5_000L));
    }

    @Test
    public void sendsBaseIntervalAfterTwentySeconds() {
        assertTrue(LocationThrottle.shouldSend(true, LAT, LNG, 1_000L, offsetMeters(12), LNG, 10, 23_000L));
    }

    @Test
    public void sendsHeartbeatAfterSixtySeconds() {
        assertTrue(LocationThrottle.shouldSend(true, LAT, LNG, 1_000L, LAT, LNG, 10, 62_000L));
    }

    @Test
    public void neverSendsImpreciseFix() {
        assertFalse(LocationThrottle.shouldSend(false, 0, 0, 0, LAT, LNG, 900, 1_000L));
    }

    @Test
    public void acceptsRecentAndSmallFutureSkew() {
        long now = 1_700_000_000_000L;

        assertTrue(LocationThrottle.isFresh(now, now));
        assertTrue(LocationThrottle.isFresh(now - LocationThrottle.MAX_FIX_AGE_MS, now));
        assertTrue(LocationThrottle.isFresh(now + 60_000L, now));
    }

    @Test
    public void rejectsStaleMissingAndFutureFixes() {
        long now = 1_700_000_000_000L;

        assertFalse(LocationThrottle.isFresh(now - LocationThrottle.MAX_FIX_AGE_MS - 1L, now));
        assertFalse(LocationThrottle.isFresh(0L, now));
        assertFalse(LocationThrottle.isFresh(now + 60_001L, now));
    }
}
