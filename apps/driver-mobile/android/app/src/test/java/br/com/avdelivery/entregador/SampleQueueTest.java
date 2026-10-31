package br.com.avdelivery.entregador;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class SampleQueueTest {
    private static LocationSample sample(long recordedAt) {
        return new LocationSample(-23.55d, -46.63d, 10d, recordedAt);
    }

    @Test
    public void keepsFifoOrder() {
        SampleQueue queue = new SampleQueue(10, 60_000L);
        queue.enqueue(sample(1_000L), 1_000L);
        queue.enqueue(sample(2_000L), 2_000L);

        assertEquals(2, queue.size());
        assertEquals(1_000L, queue.pop().getRecordedAt());
        assertEquals(2_000L, queue.pop().getRecordedAt());
        assertNull(queue.pop());
    }

    @Test
    public void dropsOldestWhenFull() {
        SampleQueue queue = new SampleQueue(2, 60_000L);
        queue.enqueue(sample(1_000L), 1_000L);
        queue.enqueue(sample(2_000L), 2_000L);
        queue.enqueue(sample(3_000L), 3_000L);

        assertEquals(2, queue.size());
        assertEquals(2_000L, queue.peek().getRecordedAt());
    }

    @Test
    public void expiresSamplesOlderThanWindow() {
        SampleQueue queue = new SampleQueue(10, 15_000L);
        queue.enqueue(sample(1_000L), 1_000L);
        queue.enqueue(sample(10_000L), 10_000L);
        queue.enqueue(sample(40_000L), 40_000L);

        assertEquals(1, queue.size());
        assertEquals(40_000L, queue.peek().getRecordedAt());
    }

    @Test
    public void clearEmptiesQueue() {
        SampleQueue queue = new SampleQueue();
        queue.enqueue(sample(1_000L), 1_000L);
        queue.clear();

        assertEquals(0, queue.size());
    }
}
