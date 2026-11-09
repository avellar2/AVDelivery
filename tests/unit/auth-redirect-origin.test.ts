import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const siteOrigin = vi.fn(async () => "https://homolog.example.com");

vi.mock("@/modules/auth/site-url", () => ({
  getSiteOrigin: () => siteOrigin(),
}));

vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: vi.fn(() => true),
}));

const createSupabaseRouteClient = vi.fn();

vi.mock("@/lib/supabase/route", () => ({
  createSupabaseRouteClient: (...args: unknown[]) => createSupabaseRouteClient(...args),
}));

import { GET as confirm } from "@/app/auth/confirm/route";
import { POST as signOut } from "@/app/auth/signout/route";

// A reverse proxy hands the app an internal host; browsers must never see it.
const internalUrl = "https://localhost:10000/auth/signout";

describe("redirects de autenticação usam a origem pública", () => {
  beforeEach(() => {
    siteOrigin.mockClear();
    createSupabaseRouteClient.mockReset();
    createSupabaseRouteClient.mockReturnValue(null);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("signout redireciona para a origem pública e não para o host interno", async () => {
    const response = await signOut(new NextRequest(internalUrl, { method: "POST" }));

    expect(siteOrigin).toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://homolog.example.com/login");
  });

  it("confirm sem token redireciona para o login público", async () => {
    const request = new NextRequest("https://localhost:10000/auth/confirm");

    const response = await confirm(request);

    expect(siteOrigin).toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://homolog.example.com/login?error=link_invalido",
    );
  });

  it("confirm com token válido redireciona para o destino público", async () => {
    const verifyOtp = vi.fn(async () => ({ error: null }));
    createSupabaseRouteClient.mockReturnValue({ auth: { verifyOtp } });

    const request = new NextRequest(
      "https://localhost:10000/auth/confirm?token_hash=abc123&type=recovery&next=/reset-password",
    );

    const response = await confirm(request);

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc123", type: "recovery" });
    expect(response.headers.get("location")).toBe("https://homolog.example.com/reset-password");
  });
});
