package br.com.avdelivery.entregador;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;

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

    @Test
    public void concurrentProducersKeepQueueBounded() throws Exception {
        SampleQueue queue = new SampleQueue(50, 3_600_000L);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        CountDownLatch start = new CountDownLatch(1);
        Thread[] threads = new Thread[4];

        for (int index = 0; index < threads.length; index++) {
            final int worker = index;
            threads[index] = new Thread(() -> {
                try {
                    start.await();

                    for (int item = 0; item < 2_000; item++) {
                        long timestamp = (long) worker * 10_000L + item;
                        queue.enqueue(sample(timestamp), timestamp);

                        if (item % 3 == 0) {
                            queue.pop();
                        }
                    }
                } catch (Throwable error) {
                    failure.compareAndSet(null, error);
                }
            });
            threads[index].start();
        }

        start.countDown();

        for (Thread thread : threads) {
            thread.join(10_000L);
        }

        assertNull(failure.get());
        assertTrue(queue.size() <= 50);
    }
}
