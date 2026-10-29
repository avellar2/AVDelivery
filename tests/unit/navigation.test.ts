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

  it("mantém módulos futuros como em breve", () => {
    const items = getDashboardNavItems("owner");

    for (const key of ["orders", "deliveries", "staff"] as const) {
      const item = items.find((entry) => entry.key === key);
      expect(item).toMatchObject({ href: null, available: false });
      expect(item?.locked).toBeUndefined();
    }
  });

  it("bloqueia o cardápio sem loja ativa", () => {
    const products = getDashboardNavItems(null).find((item) => item.key === "products");

    expect(products).toMatchObject({ href: null, available: false, locked: true });
  });
});
