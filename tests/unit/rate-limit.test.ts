import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkRateLimit } from "@/modules/orders/rate-limit";

describe("limitador de tentativas", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("permite até o limite e bloqueia depois", () => {
    const key = "checkout:127.0.0.1:loja-teste";
    const windowMs = 60_000;

    expect(checkRateLimit(key, 2, windowMs).allowed).toBe(true);
    expect(checkRateLimit(key, 2, windowMs).allowed).toBe(true);

    const blocked = checkRateLimit(key, 2, windowMs);

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("libera novamente após a janela", () => {
    const key = "tracking:127.0.0.1";
    const windowMs = 1_000;

    expect(checkRateLimit(key, 1, windowMs).allowed).toBe(true);
    expect(checkRateLimit(key, 1, windowMs).allowed).toBe(false);

    vi.setSystemTime(new Date("2026-01-01T00:00:01.500Z"));

    expect(checkRateLimit(key, 1, windowMs).allowed).toBe(true);
  });

  it("mantém contadores separados por chave", () => {
    expect(checkRateLimit("checkout:ip-a", 1, 60_000).allowed).toBe(true);
    expect(checkRateLimit("checkout:ip-a", 1, 60_000).allowed).toBe(false);
    expect(checkRateLimit("checkout:ip-b", 1, 60_000).allowed).toBe(true);
  });
});
