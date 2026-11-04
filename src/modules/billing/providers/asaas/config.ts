/**
 * Asaas configuration. This homologation is Sandbox-only: production
 * endpoints and production environments are rejected before any request.
 * The API key and webhook token are read from the server environment and are
 * never written to the database, logs, responses or the browser bundle.
 */

export const ASAAS_SANDBOX_BASE_URL = "https://api-sandbox.asaas.com/v3";
export const ASAAS_MIN_WEBHOOK_TOKEN_LENGTH = 24;

export type AsaasEnvironment = "sandbox";

export type AsaasConfig = Readonly<{
  environment: AsaasEnvironment;
  baseUrl: string;
  apiKey: string;
  userAgent: string;
  timeoutMs: number;
}>;

export class AsaasConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AsaasConfigurationError";
  }
}

type Environment = Record<string, string | undefined>;

function read(env: Environment, name: string): string {
  return env[name]?.trim() ?? "";
}

function normalizeBaseUrl(raw: string): string {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new AsaasConfigurationError("ASAAS_BASE_URL não é uma URL válida.");
  }

  if (url.protocol !== "https:") {
    throw new AsaasConfigurationError("A integração Asaas exige HTTPS.");
  }

  if (url.hostname === "api.asaas.com" || url.hostname === "www.asaas.com") {
    throw new AsaasConfigurationError(
      "Endpoints de produção do Asaas são proibidos nesta homologação.",
    );
  }

  if (url.hostname !== "api-sandbox.asaas.com") {
    throw new AsaasConfigurationError(
      "Somente o endpoint oficial de Sandbox do Asaas é permitido nesta etapa.",
    );
  }

  if (url.pathname.replace(/\/+$/, "") !== "/v3") {
    throw new AsaasConfigurationError("O endpoint do Asaas deve usar o caminho /v3.");
  }

  return `${url.origin}/v3`;
}

/**
 * Returns null when the integration is not configured, so the product still
 * works and the UI can explain what is missing. Throws on unsafe values.
 */
export function resolveAsaasConfig(env: Environment = process.env): AsaasConfig | null {
  const apiKey = read(env, "ASAAS_API_KEY");

  if (!apiKey) {
    return null;
  }

  const environment = (read(env, "ASAAS_ENVIRONMENT") || "sandbox").toLowerCase();

  if (environment !== "sandbox") {
    throw new AsaasConfigurationError(
      "Somente o ambiente Sandbox do Asaas é permitido nesta homologação.",
    );
  }

  if (/[\s\u0000-\u001f]/.test(apiKey)) {
    throw new AsaasConfigurationError("ASAAS_API_KEY contém caracteres inválidos.");
  }

  if (apiKey.length < 20) {
    throw new AsaasConfigurationError("ASAAS_API_KEY parece incompleta.");
  }

  const baseUrl = normalizeBaseUrl(read(env, "ASAAS_BASE_URL") || ASAAS_SANDBOX_BASE_URL);
  const timeoutRaw = Number(read(env, "ASAAS_TIMEOUT_MS") || "15000");
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw >= 3_000 && timeoutRaw <= 60_000
      ? Math.trunc(timeoutRaw)
      : 15_000;

  return {
    environment: "sandbox",
    baseUrl,
    apiKey,
    userAgent: read(env, "ASAAS_USER_AGENT") || "AVDelivery/1.0",
    timeoutMs,
  };
}

export function resolveAsaasWebhookToken(env: Environment = process.env): string | null {
  const token = read(env, "ASAAS_WEBHOOK_TOKEN");

  if (!token) {
    return null;
  }

  if (/[\s\u0000-\u001f]/.test(token)) {
    throw new AsaasConfigurationError("ASAAS_WEBHOOK_TOKEN contém caracteres inválidos.");
  }

  if (token.length < ASAAS_MIN_WEBHOOK_TOKEN_LENGTH) {
    throw new AsaasConfigurationError(
      `ASAAS_WEBHOOK_TOKEN deve ter pelo menos ${ASAAS_MIN_WEBHOOK_TOKEN_LENGTH} caracteres.`,
    );
  }

  return token;
}

/** Browser-safe status: never includes keys, URLs with credentials or tokens. */
export function getAsaasConfigurationStatus(env: Environment = process.env): {
  configured: boolean;
  environment: "sandbox";
  missing: string[];
} {
  const missing: string[] = [];

  try {
    if (!resolveAsaasConfig(env)) {
      missing.push("ASAAS_API_KEY");
    }
  } catch {
    missing.push("ASAAS_API_KEY");
  }

  try {
    if (!resolveAsaasWebhookToken(env)) {
      missing.push("ASAAS_WEBHOOK_TOKEN");
    }
  } catch {
    missing.push("ASAAS_WEBHOOK_TOKEN");
  }

  return {
    configured: missing.length === 0,
    environment: "sandbox",
    missing,
  };
}
