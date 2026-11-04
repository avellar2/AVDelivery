import type { ZodType } from "zod";

import type { AsaasConfig } from "./config";
import { AsaasError } from "./errors";
import { parseRetryAfterSeconds, retryDelayMs, shouldRetryStatus } from "./retry";
import { asaasErrorSchema } from "./schemas";

const MAX_RESPONSE_BYTES = 1_000_000;

type QueryValue = string | number | boolean | null | undefined;

export type AsaasRequest<T> = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  schema: ZodType<T>;
};

type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

export type AsaasHttpOptions = {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
};

function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): URL {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === null || value === undefined || value === "") {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url;
}

function safeProviderError(json: unknown): { code: string | null; description: string | null } {
  const parsed = asaasErrorSchema.safeParse(json);
  const first = parsed.success ? parsed.data.errors?.[0] : null;

  return {
    code: first?.code?.trim() || null,
    description: first?.description?.trim().slice(0, 300) || null,
  };
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export class AsaasHttpClient {
  private readonly config: AsaasConfig;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(config: AsaasConfig, options: AsaasHttpOptions = {}) {
    this.config = config;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxRetries = Math.max(0, Math.min(4, options.maxRetries ?? 2));
  }

  async request<T>({ method, path, query, body, schema }: AsaasRequest<T>) {
    const url = buildUrl(this.config.baseUrl, path, query);
    let lastError: AsaasError | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          method,
          headers: {
            access_token: this.config.apiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": this.config.userAgent,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.timeoutMs),
          cache: "no-store",
        });

        const retryAfter = parseRetryAfterSeconds(response.headers.get("retry-after"));
        const text = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
        let json: unknown = null;

        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            throw new AsaasError("INVALID_RESPONSE", "O Asaas retornou uma resposta inválida.", {
              status: response.status,
            });
          }
        }

        if (!response.ok) {
          const provider = safeProviderError(json);
          const retryable = shouldRetryStatus(response.status);

          if (retryable && attempt < this.maxRetries) {
            await this.sleep(retryDelayMs(attempt, retryAfter));
            continue;
          }

          if (response.status === 401 || response.status === 403) {
            throw new AsaasError(
              "AUTH",
              "O Asaas recusou a credencial de Sandbox. Verifique a chave configurada no servidor.",
              { status: response.status, providerCode: provider.code },
            );
          }

          if (response.status === 404) {
            throw new AsaasError("NOT_FOUND", "Registro não encontrado no Asaas.", {
              status: response.status,
              providerCode: provider.code,
            });
          }

          if (retryable) {
            throw new AsaasError(
              response.status === 429 ? "RATE_LIMIT" : "SERVER",
              "O Asaas não concluiu a operação. Tente novamente em instantes.",
              { status: response.status, providerCode: provider.code, retryable: true },
            );
          }

          throw new AsaasError(
            "VALIDATION",
            provider.description || "O Asaas recusou os dados enviados.",
            { status: response.status, providerCode: provider.code },
          );
        }

        const parsed = schema.safeParse(json);

        if (!parsed.success) {
          throw new AsaasError(
            "INVALID_RESPONSE",
            "O Asaas retornou dados em formato inesperado.",
            {
              status: response.status,
            },
          );
        }

        return parsed.data;
      } catch (error) {
        if (error instanceof AsaasError) {
          lastError = error;

          if (error.retryable && attempt < this.maxRetries) {
            await this.sleep(retryDelayMs(attempt));
            continue;
          }

          throw error;
        }

        const timeout = isTimeout(error);
        lastError = new AsaasError(
          timeout ? "TIMEOUT" : "NETWORK",
          timeout
            ? "O Asaas demorou para responder. Tente novamente."
            : "Não foi possível falar com o Asaas. Tente novamente.",
          { retryable: true, cause: error },
        );

        if (attempt < this.maxRetries) {
          await this.sleep(retryDelayMs(attempt));
          continue;
        }

        throw lastError;
      }
    }

    throw (
      lastError ??
      new AsaasError("NETWORK", "Não foi possível falar com o Asaas. Tente novamente.", {
        retryable: true,
      })
    );
  }
}
