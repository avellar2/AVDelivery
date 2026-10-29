import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "@/lib/redirects";

describe("safeRedirectPath", () => {
  it("mantém caminhos internos", () => {
    expect(safeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("/dashboard/configuracoes")).toBe("/dashboard/configuracoes");
    expect(safeRedirectPath("/dashboard?tab=loja")).toBe("/dashboard?tab=loja");
  });

  it("bloqueia URLs absolutas", () => {
    expect(safeRedirectPath("https://evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("//evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("///evil.example")).toBe("/dashboard");
  });

  it("bloqueia caminhos com barra invertida e caracteres de controle", () => {
    expect(safeRedirectPath("/\\evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("/dashboard\nSet-Cookie: x")).toBe("/dashboard");
  });

  it("usa o fallback para valores inválidos", () => {
    expect(safeRedirectPath(null)).toBe("/dashboard");
    expect(safeRedirectPath(undefined)).toBe("/dashboard");
    expect(safeRedirectPath(42)).toBe("/dashboard");
    expect(safeRedirectPath("dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("")).toBe("/dashboard");
    expect(safeRedirectPath("https://evil.example", "/login")).toBe("/login");
  });
});
