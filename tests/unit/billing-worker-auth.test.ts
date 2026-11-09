import { describe, expect, it } from "vitest";

import {
  authorizeBillingJob,
  BILLING_JOB_SECRET_MIN_LENGTH,
  resolveBillingJobSecret,
} from "@/modules/billing/worker-auth";

const secret = "s".repeat(BILLING_JOB_SECRET_MIN_LENGTH);

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/internal/billing/worker", { headers });
}

describe("autorização dos jobs internos", () => {
  it("aceita o segredo dedicado via Authorization Bearer", () => {
    expect(
      authorizeBillingJob(request({ authorization: `Bearer ${secret}` }), {
        BILLING_WORKER_SECRET: secret,
      }),
    ).toEqual({ ok: true });
  });

  it("aceita o segredo via header dedicado", () => {
    expect(
      authorizeBillingJob(request({ "x-billing-worker-secret": secret }), {
        BILLING_WORKER_SECRET: secret,
      }),
    ).toEqual({ ok: true });
  });

  it("usa CRON_SECRET como fallback", () => {
    expect(resolveBillingJobSecret({ CRON_SECRET: secret })).toBe(secret);
    expect(
      authorizeBillingJob(request({ authorization: `Bearer ${secret}` }), { CRON_SECRET: secret }),
    ).toEqual({ ok: true });
  });

  it("falha fechado quando nenhum segredo está configurado", () => {
    expect(authorizeBillingJob(request({ authorization: `Bearer ${secret}` }), {})).toEqual({
      ok: false,
      status: 503,
      error: "job_not_configured",
    });
  });

  it("falha fechado quando o segredo dedicado é fraco, mesmo com fallback válido", () => {
    expect(
      resolveBillingJobSecret({ BILLING_WORKER_SECRET: "curto", CRON_SECRET: secret }),
    ).toBeNull();
    expect(
      authorizeBillingJob(request({ authorization: `Bearer ${secret}` }), {
        BILLING_WORKER_SECRET: "curto",
        CRON_SECRET: secret,
      }),
    ).toEqual({ ok: false, status: 503, error: "job_not_configured" });
  });

  it("rejeita segredo ausente ou divergente", () => {
    expect(authorizeBillingJob(request(), { BILLING_WORKER_SECRET: secret })).toEqual({
      ok: false,
      status: 401,
      error: "unauthorized",
    });
    expect(
      authorizeBillingJob(request({ authorization: `Bearer ${secret}x` }), {
        BILLING_WORKER_SECRET: secret,
      }),
    ).toEqual({ ok: false, status: 401, error: "unauthorized" });
  });

  it("rejeita segredo com espaço interno ou caractere de controle", () => {
    expect(resolveBillingJobSecret({ BILLING_WORKER_SECRET: `${secret} ` })).toBe(secret);
    expect(resolveBillingJobSecret({ BILLING_WORKER_SECRET: `${secret}\n${secret}` })).toBeNull();
    expect(resolveBillingJobSecret({ BILLING_WORKER_SECRET: "x".repeat(256) })).toBeNull();
  });
});
