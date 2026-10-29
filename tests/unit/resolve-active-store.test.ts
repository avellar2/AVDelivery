import { describe, expect, it } from "vitest";

import {
  resolveActiveStore,
  type StoreMembershipSummary,
} from "@/modules/memberships/resolve-active-store";
import type { StoreMemberRole } from "@/types/database";

function membership(
  storeId: string,
  role: StoreMemberRole = "owner",
  overrides: Partial<StoreMembershipSummary> = {},
): StoreMembershipSummary {
  return {
    membershipId: `membership-${storeId}`,
    storeId,
    storeName: `Loja ${storeId}`,
    storeSlug: `loja-${storeId}`,
    storeActive: true,
    role,
    ...overrides,
  };
}

describe("resolveActiveStore", () => {
  it("retorna none quando o usuário não tem vínculos", () => {
    expect(resolveActiveStore([], null)).toEqual({ status: "none" });
  });

  it("seleciona automaticamente a única loja do usuário", () => {
    const storeA = membership("a");

    expect(resolveActiveStore([storeA], null)).toEqual({
      status: "active",
      membership: storeA,
    });
  });

  it("exige escolha quando o usuário tem mais de uma loja e não há cookie", () => {
    expect(resolveActiveStore([membership("a"), membership("b")], null)).toEqual({
      status: "choose",
    });
  });

  it("respeita o cookie quando ele aponta para uma loja permitida", () => {
    const storeB = membership("b", "manager");

    expect(resolveActiveStore([membership("a"), storeB], "b")).toEqual({
      status: "active",
      membership: storeB,
    });
  });

  it("ignora cookie de loja da qual o usuário não é membro", () => {
    expect(resolveActiveStore([membership("a"), membership("b")], "loja-de-outro-tenant")).toEqual({
      status: "choose",
    });
  });

  it("não aceita cookie de outro tenant nem quando o usuário tem apenas uma loja", () => {
    const storeA = membership("a");

    expect(resolveActiveStore([storeA], "loja-de-outro-tenant")).toEqual({
      status: "active",
      membership: storeA,
    });
  });

  it("nunca devolve uma loja fora da lista de vínculos", () => {
    const resolution = resolveActiveStore([membership("a")], "b");

    expect(resolution.status).toBe("active");
    if (resolution.status === "active") {
      expect(resolution.membership.storeId).toBe("a");
    }
  });
});
