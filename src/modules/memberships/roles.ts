import type { StoreMemberRole } from "@/types/database";

export const STORE_ROLES: readonly StoreMemberRole[] = ["owner", "manager", "employee", "driver"];

export const ROLE_LABELS: Record<StoreMemberRole, string> = {
  owner: "Proprietário",
  manager: "Gerente",
  employee: "Funcionário",
  driver: "Entregador",
};

export function isStoreMemberRole(value: unknown): value is StoreMemberRole {
  return typeof value === "string" && STORE_ROLES.includes(value as StoreMemberRole);
}

export function roleLabel(role: StoreMemberRole): string {
  return ROLE_LABELS[role];
}

export function canManageSettings(role: StoreMemberRole): boolean {
  return role === "owner" || role === "manager";
}

export function canManageMenu(role: StoreMemberRole): boolean {
  return role === "owner" || role === "manager";
}

export function canManageMembers(role: StoreMemberRole): boolean {
  return role === "owner";
}

export function canToggleStoreActive(role: StoreMemberRole): boolean {
  return role === "owner";
}
