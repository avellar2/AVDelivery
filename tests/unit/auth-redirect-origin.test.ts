import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: vi.fn(() => true),
}));

const createSupabaseRouteClient = vi.fn();

vi.mock("@/lib/supabase/route", () => ({
  createSupabaseRouteClient: (...args: unknown[]) => createSupabaseRouteClient(...args),
}));

import { GET as confirm } from "@/app/auth/confirm/route";
import { POST as signOut } from "@/app/auth/signout/route";

// A reverse proxy hands the app an internal host; the browser must never see it.
const internalUrl = "https://localhost:10000";

describe("redirects de autenticação não vazam o host interno", () => {
  beforeEach(() => {
    createSupabaseRouteClient.mockReset();
    createSupabaseRouteClient.mockReturnValue(null);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("signout responde com Location relativo", async () => {
    const response = await signOut(
      new NextRequest(`${internalUrl}/auth/signout`, { method: "POST" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("confirm sem token responde com Location relativo", async () => {
    const response = await confirm(new NextRequest(`${internalUrl}/auth/confirm`));

    expect(response.headers.get("location")).toBe("/login?error=link_invalido");
  });

  it("confirm com token válido redireciona para o destino pedido", async () => {
    const verifyOtp = vi.fn(async () => ({ error: null }));
    createSupabaseRouteClient.mockReturnValue({ auth: { verifyOtp } });

    const response = await confirm(
      new NextRequest(
        `${internalUrl}/auth/confirm?token_hash=abc123&type=recovery&next=/reset-password`,
      ),
    );

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc123", type: "recovery" });
    expect(response.headers.get("location")).toBe("/reset-password");
  });

  it("não usa o host da requisição em nenhum redirecionamento", async () => {
    const responses = [
      await signOut(new NextRequest(`${internalUrl}/auth/signout`, { method: "POST" })),
      await confirm(new NextRequest(`${internalUrl}/auth/confirm`)),
      await confirm(new NextRequest(`${internalUrl}/auth/confirm?error=access_denied`)),
    ];

    for (const response of responses) {
      const location = response.headers.get("location") ?? "";
      expect(location.startsWith("/")).toBe(true);
      expect(location).not.toContain("localhost");
      expect(location).not.toContain("http");
    }
  });
});
