import { describe, expect, it } from "vitest";

import {
  ROLE_LABELS,
  STORE_ROLES,
  canManageMembers,
  canManageMenu,
  canManageSettings,
  canToggleStoreActive,
  isStoreMemberRole,
  roleLabel,
} from "@/modules/memberships/roles";

describe("papéis de estabelecimento", () => {
  it("expõe exatamente os quatro papéis iniciais", () => {
    expect(STORE_ROLES).toEqual(["owner", "manager", "employee", "driver"]);
  });

  it("reconhece apenas papéis válidos", () => {
    expect(isStoreMemberRole("owner")).toBe(true);
    expect(isStoreMemberRole("admin")).toBe(false);
    expect(isStoreMemberRole(null)).toBe(false);
    expect(isStoreMemberRole(42)).toBe(false);
  });

  it("permite configurações apenas para proprietário e gerente", () => {
    expect(canManageSettings("owner")).toBe(true);
    expect(canManageSettings("manager")).toBe(true);
    expect(canManageSettings("employee")).toBe(false);
    expect(canManageSettings("driver")).toBe(false);
  });

  it("permite gerenciar o cardápio apenas para proprietário e gerente", () => {
    expect(canManageMenu("owner")).toBe(true);
    expect(canManageMenu("manager")).toBe(true);
    expect(canManageMenu("employee")).toBe(false);
    expect(canManageMenu("driver")).toBe(false);
  });

  it("permite gerenciar membros apenas para o proprietário", () => {
    expect(canManageMembers("owner")).toBe(true);
    expect(canManageMembers("manager")).toBe(false);
  });

  it("permite alterar o status da loja apenas para o proprietário", () => {
    expect(canToggleStoreActive("owner")).toBe(true);
    expect(canToggleStoreActive("manager")).toBe(false);
    expect(canToggleStoreActive("employee")).toBe(false);
    expect(canToggleStoreActive("driver")).toBe(false);
  });

  it("traduz todos os papéis", () => {
    for (const role of STORE_ROLES) {
      expect(roleLabel(role)).toBe(ROLE_LABELS[role]);
      expect(roleLabel(role).length).toBeGreaterThan(0);
    }
  });
});
