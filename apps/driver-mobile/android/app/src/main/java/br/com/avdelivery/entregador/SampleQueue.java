package br.com.avdelivery.entregador;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;

/** Bounded, in-memory queue used while the device has no connectivity. */
public final class SampleQueue {
    public static final int DEFAULT_MAX_SIZE = 60;
    public static final long DEFAULT_MAX_AGE_MS = 15 * 60_000L;

    private final Deque<LocationSample> samples = new ArrayDeque<>();
    private final int maxSize;
    private final long maxAgeMs;

    public SampleQueue() {
        this(DEFAULT_MAX_SIZE, DEFAULT_MAX_AGE_MS);
    }

    public SampleQueue(int maxSize, long maxAgeMs) {
        if (maxSize < 1) {
            throw new IllegalArgumentException("maxSize must be positive");
        }
        this.maxSize = maxSize;
        this.maxAgeMs = maxAgeMs;
    }

    public synchronized void enqueue(LocationSample sample, long now) {
        dropExpired(now);

        while (samples.size() >= maxSize) {
            samples.removeFirst();
        }

        samples.addLast(sample);
    }

    public synchronized LocationSample peek() {
        return samples.peekFirst();
    }

    public synchronized LocationSample pop() {
        return samples.pollFirst();
    }

    public synchronized int size() {
        return samples.size();
    }

    public synchronized void clear() {
        samples.clear();
    }

    private void dropExpired(long now) {
        Iterator<LocationSample> iterator = samples.iterator();

        while (iterator.hasNext()) {
            LocationSample sample = iterator.next();

            if (now - sample.getRecordedAt() > maxAgeMs) {
                iterator.remove();
            } else {
                break;
            }
        }
    }
}
