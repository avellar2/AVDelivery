import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { AsaasConfig } from "@/modules/billing/providers/asaas/config";
import { AsaasError } from "@/modules/billing/providers/asaas/errors";
import { AsaasHttpClient } from "@/modules/billing/providers/asaas/http";
import {
  parseRetryAfterSeconds,
  retryDelayMs,
  shouldRetryStatus,
} from "@/modules/billing/providers/asaas/retry";

const config: AsaasConfig = {
  environment: "sandbox",
  baseUrl: "https://api-sandbox.asaas.com/v3",
  apiKey: "$aact_hmlg_0000000000000001",
  userAgent: "AVDelivery/Test",
  timeoutMs: 5_000,
};

const schema = z.object({ id: z.string() });

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("cliente HTTP do Asaas", () => {
  it("envia access_token, user-agent e consulta com segurança", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const client = new AsaasHttpClient(config, {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({ id: "cus_123" });
      },
    });

    const result = await client.request({
      method: "GET",
      path: "/customers",
      query: { externalReference: "store-1", empty: "", offset: 0 },
      schema,
    });

    expect(result.id).toBe("cus_123");
    expect(calls).toHaveLength(1);
    expect(calls[0].url.toString()).toBe(
      "https://api-sandbox.asaas.com/v3/customers?externalReference=store-1&offset=0",
    );

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.access_token).toBe(config.apiKey);
    expect(headers["User-Agent"]).toBe("AVDelivery/Test");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("repete uma leitura após 5xx com backoff", async () => {
    const sleep = vi.fn(async () => undefined);
    let attempts = 0;
    const client = new AsaasHttpClient(config, {
      sleep,
      maxRetries: 1,
      fetchImpl: async () => {
        attempts += 1;
        return attempts === 1
          ? jsonResponse({ errors: [{ code: "server" }] }, 503)
          : jsonResponse({ id: "cus_123" });
      },
    });

    const result = await client.request({ method: "GET", path: "/customers", schema });
    expect(result.id).toBe("cus_123");
    expect(attempts).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("não repete erro de autenticação e não inclui a chave na mensagem", async () => {
    let attempts = 0;
    const client = new AsaasHttpClient(config, {
      maxRetries: 2,
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse(
          { errors: [{ code: "invalid_access_token", description: "Chave inválida" }] },
          401,
        );
      },
    });

    await expect(
      client.request({ method: "GET", path: "/customers", schema }),
    ).rejects.toMatchObject({ code: "AUTH" });
    expect(attempts).toBe(1);

    try {
      await client.request({ method: "GET", path: "/customers", schema });
    } catch (error) {
      expect(error).toBeInstanceOf(AsaasError);
      expect((error as Error).message).not.toContain(config.apiKey);
    }
  });

  it("recusa resposta em formato inesperado", async () => {
    const client = new AsaasHttpClient(config, {
      maxRetries: 0,
      fetchImpl: async () => jsonResponse({ unexpected: true }),
    });

    await expect(
      client.request({ method: "GET", path: "/customers", schema }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("distingue falha de rede de erro de validação", async () => {
    const network = new AsaasHttpClient(config, {
      maxRetries: 0,
      fetchImpl: async () => {
        throw new Error("socket fechado");
      },
    });

    await expect(
      network.request({ method: "GET", path: "/customers", schema }),
    ).rejects.toMatchObject({ code: "NETWORK" });

    const timeout = new AsaasHttpClient(config, {
      maxRetries: 0,
      fetchImpl: async () => {
        const error = new Error("tempo esgotado");
        error.name = "TimeoutError";
        throw error;
      },
    });

    await expect(
      timeout.request({ method: "GET", path: "/customers", schema }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("respeita Retry-After e limita a espera", async () => {
    const sleep = vi.fn(async () => undefined);
    let attempts = 0;
    const client = new AsaasHttpClient(config, {
      sleep,
      maxRetries: 1,
      fetchImpl: async () => {
        attempts += 1;
        return attempts === 1
          ? jsonResponse({ errors: [] }, 429, { "retry-after": "1" })
          : jsonResponse({ id: "cus_123" });
      },
    });

    await client.request({ method: "GET", path: "/customers", schema });
    expect(sleep).toHaveBeenCalledWith(1_000);
  });
});

describe("política de retry", () => {
  it("interpreta Retry-After apenas em faixa segura", () => {
    expect(parseRetryAfterSeconds("2")).toBe(2);
    expect(parseRetryAfterSeconds("0")).toBe(0);
    expect(parseRetryAfterSeconds("-1")).toBeNull();
    expect(parseRetryAfterSeconds("999")).toBeNull();
    expect(parseRetryAfterSeconds("abc")).toBeNull();
    expect(parseRetryAfterSeconds(null)).toBeNull();
  });

  it("aplica backoff exponencial com teto e jitter", () => {
    expect(retryDelayMs(0, null, () => 0)).toBe(300);
    expect(retryDelayMs(1, null, () => 0)).toBe(600);
    expect(retryDelayMs(10, null, () => 0)).toBe(8_000);
    expect(retryDelayMs(0, 1, () => 0.5)).toBe(1_000);
  });

  it("repete apenas falhas transitórias", () => {
    expect(shouldRetryStatus(429)).toBe(true);
    expect(shouldRetryStatus(408)).toBe(true);
    expect(shouldRetryStatus(500)).toBe(true);
    expect(shouldRetryStatus(503)).toBe(true);
    expect(shouldRetryStatus(400)).toBe(false);
    expect(shouldRetryStatus(401)).toBe(false);
    expect(shouldRetryStatus(422)).toBe(false);
  });
});
