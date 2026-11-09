import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/health/route";

describe("sonda pública de disponibilidade", () => {
  it("responde 200 com o mínimo necessário e sem dados internos", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
