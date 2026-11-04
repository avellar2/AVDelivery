import { describe, expect, it } from "vitest";

import {
  ASAAS_MIN_WEBHOOK_TOKEN_LENGTH,
  ASAAS_SANDBOX_BASE_URL,
  AsaasConfigurationError,
  getAsaasConfigurationStatus,
  resolveAsaasConfig,
  resolveAsaasWebhookToken,
} from "@/modules/billing/providers/asaas/config";

const apiKey = "$aact_hmlg_0000000000000001";

describe("configuração do Asaas", () => {
  it("aceita somente o Sandbox oficial", () => {
    const config = resolveAsaasConfig({
      ASAAS_API_KEY: apiKey,
      ASAAS_BASE_URL: ASAAS_SANDBOX_BASE_URL,
      ASAAS_ENVIRONMENT: "sandbox",
    });

    expect(config).toMatchObject({
      environment: "sandbox",
      baseUrl: ASAAS_SANDBOX_BASE_URL,
      apiKey,
    });
  });

  it("usa o Sandbox como padrão quando o ambiente não é informado", () => {
    const config = resolveAsaasConfig({ ASAAS_API_KEY: apiKey });
    expect(config?.baseUrl).toBe(ASAAS_SANDBOX_BASE_URL);
    expect(config?.environment).toBe("sandbox");
  });

  it("retorna null quando a chave não está configurada", () => {
    expect(resolveAsaasConfig({})).toBeNull();
    expect(resolveAsaasConfig({ ASAAS_API_KEY: "   " })).toBeNull();
  });

  it("rejeita ambiente de produção", () => {
    expect(() =>
      resolveAsaasConfig({ ASAAS_API_KEY: apiKey, ASAAS_ENVIRONMENT: "production" }),
    ).toThrow(AsaasConfigurationError);
  });

  it("rejeita o endpoint proibido de produção", () => {
    expect(() =>
      resolveAsaasConfig({
        ASAAS_API_KEY: apiKey,
        ASAAS_BASE_URL: "https://api.asaas.com/v3",
      }),
    ).toThrow(AsaasConfigurationError);
  });

  it("rejeita qualquer host que não seja o Sandbox oficial", () => {
    for (const url of [
      "https://example.com/v3",
      "https://api-sandbox.asaas.com.evil.example/v3",
      "http://api-sandbox.asaas.com/v3",
      "https://api-sandbox.asaas.com/v2",
    ]) {
      expect(() => resolveAsaasConfig({ ASAAS_API_KEY: apiKey, ASAAS_BASE_URL: url })).toThrow(
        AsaasConfigurationError,
      );
    }
  });

  it("rejeita chave com caracteres inválidos ou curta", () => {
    expect(() => resolveAsaasConfig({ ASAAS_API_KEY: "curta" })).toThrow(AsaasConfigurationError);
    expect(() => resolveAsaasConfig({ ASAAS_API_KEY: `${apiKey}\n${apiKey}` })).toThrow(
      AsaasConfigurationError,
    );
  });

  it("exige um token de webhook forte", () => {
    expect(resolveAsaasWebhookToken({})).toBeNull();
    expect(() => resolveAsaasWebhookToken({ ASAAS_WEBHOOK_TOKEN: "curto" })).toThrow(
      AsaasConfigurationError,
    );

    const token = "a".repeat(ASAAS_MIN_WEBHOOK_TOKEN_LENGTH);
    expect(resolveAsaasWebhookToken({ ASAAS_WEBHOOK_TOKEN: token })).toBe(token);
  });

  it("expõe apenas status seguro, nunca a chave ou o token", () => {
    const status = getAsaasConfigurationStatus({
      ASAAS_API_KEY: apiKey,
      ASAAS_WEBHOOK_TOKEN: "b".repeat(32),
    });

    expect(status).toEqual({ configured: true, environment: "sandbox", missing: [] });
    expect(JSON.stringify(status)).not.toContain(apiKey);
    expect(JSON.stringify(status)).not.toContain("bbbbbbbb");
  });

  it("lista apenas nomes de variáveis ausentes", () => {
    const status = getAsaasConfigurationStatus({});
    expect(status.configured).toBe(false);
    expect(status.missing).toEqual(["ASAAS_API_KEY", "ASAAS_WEBHOOK_TOKEN"]);
  });

  it("não considera configurado quando a URL é proibida", () => {
    const status = getAsaasConfigurationStatus({
      ASAAS_API_KEY: apiKey,
      ASAAS_BASE_URL: "https://api.asaas.com/v3",
      ASAAS_WEBHOOK_TOKEN: "b".repeat(32),
    });

    expect(status.configured).toBe(false);
    expect(status.missing).toContain("ASAAS_API_KEY");
  });
});
