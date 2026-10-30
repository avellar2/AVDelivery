import { describe, expect, it } from "vitest";

import { reconcileCart } from "@/modules/orders/cart";
import type { PublicMenuCategory } from "@/modules/menu/types";
import type { CartLine } from "@/modules/orders/types";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_ID = "22222222-2222-4222-8222-222222222222";
const OPTION_ID = "33333333-3333-4333-8333-333333333333";

function menu(overrides: { priceCents?: number; optionPrice?: number } = {}): PublicMenuCategory[] {
  return [
    {
      id: "category-1",
      name: "Lanches",
      description: null,
      products: [
        {
          id: PRODUCT_ID,
          name: "Burger",
          description: null,
          priceCents: overrides.priceCents ?? 2500,
          imageUrl: null,
          optionGroups: [
            {
              id: GROUP_ID,
              name: "Extras",
              minSelect: 0,
              maxSelect: 2,
              required: false,
              options: [
                {
                  id: OPTION_ID,
                  name: "Bacon",
                  additionalPriceCents: overrides.optionPrice ?? 400,
                },
              ],
            },
          ],
        },
      ],
    },
  ];
}

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    key: "line-1",
    productId: PRODUCT_ID,
    productName: "Burger antigo",
    basePriceCents: 2000,
    quantity: 1,
    notes: "",
    options: [
      {
        groupId: GROUP_ID,
        groupName: "Extras",
        optionId: OPTION_ID,
        name: "Bacon",
        priceCents: 400,
        quantity: 1,
      },
    ],
    ...overrides,
  };
}

describe("reconcileCart", () => {
  it("atualiza nome e preço com o cardápio atual", () => {
    const result = reconcileCart([line()], menu());

    expect(result.changed).toBe(true);
    expect(result.removed).toBe(0);
    expect(result.lines[0]).toMatchObject({ productName: "Burger", basePriceCents: 2500 });
  });

  it("remove produtos que saíram do cardápio", () => {
    const result = reconcileCart([line({ productId: "produto-removido" })], menu());

    expect(result.lines).toEqual([]);
    expect(result.removed).toBe(1);
    expect(result.changed).toBe(true);
  });

  it("remove a linha quando um adicional deixou de existir", () => {
    const stale = line({
      options: [
        {
          groupId: GROUP_ID,
          groupName: "Extras",
          optionId: "opcao-removida",
          name: "Bacon antigo",
          priceCents: 400,
          quantity: 1,
        },
      ],
    });

    const result = reconcileCart([stale], menu());

    expect(result.lines).toEqual([]);
    expect(result.removed).toBe(1);
  });

  it("ajusta a quantidade para o intervalo permitido", () => {
    const result = reconcileCart([line({ quantity: 0 })], menu());

    expect(result.changed).toBe(true);
    expect(result.lines[0]?.quantity).toBe(1);
  });

  it("não marca alteração quando o carrinho já está atualizado", () => {
    const current = line({
      productName: "Burger",
      basePriceCents: 2500,
      options: [
        {
          groupId: GROUP_ID,
          groupName: "Extras",
          optionId: OPTION_ID,
          name: "Bacon",
          priceCents: 400,
          quantity: 1,
        },
      ],
    });

    const result = reconcileCart([current], menu());

    expect(result.changed).toBe(false);
    expect(result.removed).toBe(0);
    expect(result.lines).toHaveLength(1);
  });
});
