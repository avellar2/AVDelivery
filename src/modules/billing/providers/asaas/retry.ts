export type RetryDecision = {
  retry: boolean;
  delayMs: number;
};

export function parseRetryAfterSeconds(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 120) {
    return Math.ceil(seconds);
  }

  return null;
}

/**
 * Exponential backoff with jitter, capped at 8 seconds. A provider-supplied
 * Retry-After wins, but is still capped so a webhook never hangs indefinitely.
 */
export function retryDelayMs(
  attempt: number,
  retryAfterSeconds: number | null = null,
  random: () => number = Math.random,
): number {
  if (retryAfterSeconds !== null) {
    return Math.min(8_000, retryAfterSeconds * 1_000);
  }

  const base = Math.min(8_000, 300 * 2 ** Math.max(0, attempt));
  const jitter = Math.floor(random() * 250);
  return base + jitter;
}

export function shouldRetryStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}
