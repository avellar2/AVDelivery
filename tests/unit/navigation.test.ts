import { describe, expect, it } from "vitest";

import { getDashboardNavItems } from "@/modules/dashboard/navigation";

describe("navegação do cardápio", () => {
  it("libera o cardápio para proprietário e gerente", () => {
    for (const role of ["owner", "manager"] as const) {
      const items = getDashboardNavItems(role);
      const products = items.find((item) => item.key === "products");

      expect(products).toMatchObject({
        href: "/dashboard/produtos",
        available: true,
        locked: false,
      });
    }
  });

  it("bloqueia o cardápio e configurações para funcionário e entregador", () => {
    for (const role of ["employee", "driver"] as const) {
      const items = getDashboardNavItems(role);
      const products = items.find((item) => item.key === "products");
      const settings = items.find((item) => item.key === "settings");

      expect(products).toMatchObject({ href: null, available: false, locked: true });
      expect(settings).toMatchObject({ href: null, available: false, locked: true });
    }
  });

  it("libera pedidos para proprietário, gerente e funcionário", () => {
    for (const role of ["owner", "manager", "employee"] as const) {
      const orders = getDashboardNavItems(role).find((item) => item.key === "orders");

      expect(orders).toMatchObject({
        href: "/dashboard/pedidos",
        available: true,
        locked: false,
      });
    }
  });

  it("bloqueia pedidos para entregador", () => {
    const orders = getDashboardNavItems("driver").find((item) => item.key === "orders");

    expect(orders).toMatchObject({ href: null, available: false, locked: true });
  });

  it("libera entregadores para proprietário e gerente", () => {
    for (const role of ["owner", "manager"] as const) {
      const deliveries = getDashboardNavItems(role).find((item) => item.key === "deliveries");

      expect(deliveries).toMatchObject({
        href: "/dashboard/entregadores",
        available: true,
        locked: false,
      });
    }
  });

  it("leva o entregador para a área de entregas", () => {
    const deliveries = getDashboardNavItems("driver").find((item) => item.key === "deliveries");

    expect(deliveries).toMatchObject({
      label: "Minhas entregas",
      href: "/entregador",
      available: true,
      locked: false,
    });
  });

  it("bloqueia entregas para funcionário", () => {
    const deliveries = getDashboardNavItems("employee").find((item) => item.key === "deliveries");

    expect(deliveries).toMatchObject({ href: null, available: false, locked: true });
  });

  it("mantém funcionários como módulo futuro", () => {
    const staff = getDashboardNavItems("owner").find((item) => item.key === "staff");

    expect(staff).toMatchObject({ href: null, available: false });
    expect(staff?.locked).toBeUndefined();
  });

  it("bloqueia o cardápio sem loja ativa", () => {
    const products = getDashboardNavItems(null).find((item) => item.key === "products");

    expect(products).toMatchObject({ href: null, available: false, locked: true });
  });
});
