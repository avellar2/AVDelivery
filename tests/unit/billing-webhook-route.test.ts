import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { POST } from "@/app/api/webhooks/asaas/route";

const token = "w".repeat(32);
const originalToken = process.env.ASAAS_WEBHOOK_TOKEN;
const createAdminMock = vi.mocked(createSupabaseAdminClient);
const rpc = vi.fn();

function adminClient() {
  return { rpc } as unknown as ReturnType<typeof createSupabaseAdminClient>;
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    event: "PAYMENT_CONFIRMED",
    payment: { id: "pay_1", subscription: "sub_1", status: "CONFIRMED" },
    ...overrides,
  };
}

function request(
  body: string = JSON.stringify(payload()),
  headers: Record<string, string> = { "asaas-access-token": token },
): Request {
  return new Request("http://localhost/api/webhooks/asaas", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("ACK do webhook Asaas", () => {
  beforeEach(() => {
    process.env.ASAAS_WEBHOOK_TOKEN = token;
    rpc.mockReset();
    createAdminMock.mockReset();
    createAdminMock.mockReturnValue(adminClient());
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterAll(() => {
    if (originalToken === undefined) {
      delete process.env.ASAAS_WEBHOOK_TOKEN;
    } else {
      process.env.ASAAS_WEBHOOK_TOKEN = originalToken;
    }
    vi.restoreAllMocks();
  });

  it("retorna 200 somente depois de persistir o evento", async () => {
    rpc.mockResolvedValue({
      data: { id: "row-1", status: "received", attempts: 0, duplicate: false },
      error: null,
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true, duplicate: false, status: "received" });
    expect(rpc).toHaveBeenCalledWith(
      "billing_receive_webhook_event",
      expect.objectContaining({
        p_provider: "asaas",
        p_external_event_id: "evt_1",
        p_event_type: "PAYMENT_CONFIRMED",
        p_resource_type: "payment",
        p_resource_id: "pay_1",
      }),
    );
  });

  it("retorna 200 para duplicata já em processamento, nunca 202", async () => {
    rpc.mockResolvedValue({
      data: { id: "row-1", status: "processing", attempts: 1, duplicate: true },
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      duplicate: true,
      status: "processing",
    });
  });

  it("retorna 200 para duplicata já processada sem alterar o estado", async () => {
    rpc.mockResolvedValue({
      data: { id: "row-1", status: "processed", attempts: 2, duplicate: true },
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "processed" });
  });

  it("não retorna 200 quando a persistência falha", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "db down | detalhe interno", code: "XX000" },
    });

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      received: false,
      error: "persistence_failed",
    });
  });

  it("rejeita token inválido antes de tocar no banco", async () => {
    const response = await POST(request(JSON.stringify(payload()), { "asaas-access-token": "x" }));

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejeita JSON inválido", async () => {
    const response = await POST(request("{"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ received: false, error: "invalid_json" });
  });

  it("rejeita envelope sem estrutura mínima", async () => {
    const response = await POST(request(JSON.stringify({ id: "evt_1" })));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ received: false, error: "invalid_structure" });
  });

  it("rejeita payload acima do limite antes de persistir", async () => {
    const huge = JSON.stringify({
      ...payload(),
      padding: "x".repeat(256 * 1024),
    });

    const response = await POST(request(huge));

    expect(response.status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });
});
