import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({})),
}));

vi.mock("@/modules/billing/job-health", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/billing/job-health")>();
  return { ...actual, readBillingJobSnapshot: vi.fn() };
});

import { GET } from "@/app/api/internal/billing/health/route";
import {
  evaluateBillingAlerts,
  readBillingJobSnapshot,
  type BillingJobRun,
  type BillingJobSnapshot,
} from "@/modules/billing/job-health";

const secret = "h".repeat(40);
const originalSecret = process.env.BILLING_WORKER_SECRET;
const originalFallback = process.env.CRON_SECRET;
const readSnapshot = vi.mocked(readBillingJobSnapshot);

// Relative to the real clock: the route evaluates against `new Date()`, so the
// fixtures must age in the same frame of reference.
const now = new Date();

function minutesAgo(minutes: number): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

function run(overrides: Partial<BillingJobRun> = {}): BillingJobRun {
  return {
    status: "succeeded",
    startedAt: minutesAgo(1),
    finishedAt: minutesAgo(1),
    claimed: 0,
    processed: 0,
    retried: 0,
    deadLettered: 0,
    reconciled: 0,
    divergences: 0,
    errors: 0,
    error: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<BillingJobSnapshot> = {}): BillingJobSnapshot {
  return {
    pending: 0,
    oldestPendingAt: null,
    pendingAgeSeconds: null,
    staleProcessing: 0,
    deadLetter: 0,
    failed: 0,
    lastWorkerRun: run(),
    lastReconciliationRun: run(),
    ...overrides,
  };
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/internal/billing/health", {
    method: "GET",
    headers,
  });
}

describe("regras de alerta do faturamento", () => {
  it("não alerta quando tudo está em dia", () => {
    expect(evaluateBillingAlerts(snapshot(), now)).toEqual({ status: "ok", alerts: [] });
  });

  it("alerta backlog quando o evento pendente passa de 5 minutos", () => {
    const result = evaluateBillingAlerts(
      snapshot({ pending: 2, oldestPendingAt: minutesAgo(6), pendingAgeSeconds: 360 }),
      now,
    );

    expect(result.status).toBe("critical");
    expect(result.alerts).toContain("pending_backlog");
  });

  it("não alerta backlog quando o pendente é recente", () => {
    const result = evaluateBillingAlerts(
      snapshot({ pending: 1, oldestPendingAt: minutesAgo(1), pendingAgeSeconds: 60 }),
      now,
    );

    expect(result.alerts).not.toContain("pending_backlog");
  });

  it("alerta lease expirado", () => {
    const result = evaluateBillingAlerts(snapshot({ staleProcessing: 1 }), now);

    expect(result.alerts).toContain("stale_processing");
    expect(result.status).toBe("critical");
  });

  it("trata dead letter como aviso, não como indisponibilidade", () => {
    const result = evaluateBillingAlerts(snapshot({ deadLetter: 8 }), now);

    expect(result).toEqual({ status: "warning", alerts: ["dead_letter"] });
  });

  it("alerta worker parado há mais de 10 minutos", () => {
    const result = evaluateBillingAlerts(
      snapshot({ lastWorkerRun: run({ startedAt: minutesAgo(12), finishedAt: minutesAgo(12) }) }),
      now,
    );

    expect(result.alerts).toContain("worker_not_running");
    expect(result.status).toBe("critical");
  });

  it("alerta worker que nunca executou", () => {
    const result = evaluateBillingAlerts(snapshot({ lastWorkerRun: null }), now);

    expect(result.alerts).toContain("worker_not_running");
  });

  it("alerta última execução do worker com falha", () => {
    const result = evaluateBillingAlerts(
      snapshot({ lastWorkerRun: run({ status: "failed", error: "provider_unavailable" }) }),
      now,
    );

    expect(result.alerts).toContain("worker_last_failed");
  });

  it("alerta conciliação parada há mais de 2 horas", () => {
    const result = evaluateBillingAlerts(
      snapshot({ lastReconciliationRun: run({ finishedAt: minutesAgo(121) }) }),
      now,
    );

    expect(result.alerts).toContain("reconciliation_not_running");
  });

  it("alerta conciliação que nunca executou", () => {
    const result = evaluateBillingAlerts(snapshot({ lastReconciliationRun: null }), now);

    expect(result.alerts).toContain("reconciliation_not_running");
  });
});

describe("rota de saúde do faturamento", () => {
  beforeEach(() => {
    process.env.BILLING_WORKER_SECRET = secret;
    delete process.env.CRON_SECRET;
    readSnapshot.mockReset();
    readSnapshot.mockResolvedValue(snapshot());
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.BILLING_WORKER_SECRET;
    } else {
      process.env.BILLING_WORKER_SECRET = originalSecret;
    }

    if (originalFallback === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalFallback;
    }

    vi.restoreAllMocks();
  });

  it("recusa sem segredo", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: "unauthorized" });
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  it("falha fechado quando o segredo não está configurado", async () => {
    delete process.env.BILLING_WORKER_SECRET;
    delete process.env.CRON_SECRET;

    const response = await GET(request({ authorization: `Bearer ${secret}` }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, error: "job_not_configured" });
  });

  it("responde 200 quando a automação está saudável", async () => {
    const response = await GET(request({ authorization: `Bearer ${secret}` }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "ok", alerts: [] });
    expect(body.checkedAt).toBeTruthy();
  });

  it("responde 200 com aviso quando só há dead letter", async () => {
    readSnapshot.mockResolvedValue(snapshot({ deadLetter: 8 }));

    const response = await GET(request({ authorization: `Bearer ${secret}` }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      status: "warning",
      alerts: ["dead_letter"],
    });
  });

  it("responde 503 quando o worker parou", async () => {
    readSnapshot.mockResolvedValue(snapshot({ lastWorkerRun: null }));

    const response = await GET(request({ authorization: `Bearer ${secret}` }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      status: "critical",
      alerts: expect.arrayContaining(["worker_not_running"]),
    });
  });

  it("responde 503 quando a leitura falha", async () => {
    readSnapshot.mockRejectedValue(new Error("database_down"));

    const response = await GET(request({ authorization: `Bearer ${secret}` }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, alerts: ["health_unavailable"] });
  });
});
