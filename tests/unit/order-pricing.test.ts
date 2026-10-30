import { describe, expect, it } from "vitest";

import {
  cartLineTotal,
  cartLineUnitPriceCents,
  cartSubtotalCents,
  cartTotals,
  buildCheckoutInput,
} from "@/modules/orders/cart";
import { computeCartTotals, itemUnitPriceCents, lineTotalCents } from "@/modules/orders/pricing";
import type { CartLine } from "@/modules/orders/types";

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    key: "line-1",
    productId: "product-1",
    productName: "Burger",
    basePriceCents: 2500,
    quantity: 1,
    notes: "",
    options: [],
    ...overrides,
  };
}

describe("preço de itens e adicionais", () => {
  it("soma adicionais considerando a quantidade", () => {
    const unit = itemUnitPriceCents(2500, [
      { priceCents: 400, quantity: 1 },
      { priceCents: 250, quantity: 2 },
    ]);

    expect(unit).toBe(3400);
  });

  it("calcula o total da linha pela quantidade", () => {
    expect(lineTotalCents(2900, 3)).toBe(8700);
  });

  it("calcula o preço unitário e total do carrinho", () => {
    const item = line({
      options: [
        {
          groupId: "group-1",
          groupName: "Extras",
          optionId: "option-1",
          name: "Bacon",
          priceCents: 400,
          quantity: 2,
        },
      ],
      quantity: 2,
    });

    expect(cartLineUnitPriceCents(item)).toBe(3300);
    expect(cartLineTotal(item)).toBe(6600);
    expect(cartSubtotalCents([item, line()])).toBe(9100);
  });
});

describe("totais do pedido", () => {
  it("aplica taxa de entrega apenas para delivery", () => {
    const delivery = computeCartTotals([{ unitPriceCents: 2500, quantity: 1 }], {
      fulfillmentType: "delivery",
      deliveryFeeCents: 590,
      minOrderCents: 0,
    });

    expect(delivery).toEqual({
      subtotalCents: 2500,
      deliveryFeeCents: 590,
      totalCents: 3090,
      meetsMinimum: true,
      missingForMinimumCents: 0,
    });

    const pickup = computeCartTotals([{ unitPriceCents: 2500, quantity: 1 }], {
      fulfillmentType: "pickup",
      deliveryFeeCents: 590,
      minOrderCents: 0,
    });

    expect(pickup.deliveryFeeCents).toBe(0);
    expect(pickup.totalCents).toBe(2500);
  });

  it("informa quanto falta para o pedido mínimo", () => {
    const totals = computeCartTotals([{ unitPriceCents: 1500, quantity: 1 }], {
      fulfillmentType: "pickup",
      deliveryFeeCents: 0,
      minOrderCents: 3000,
    });

    expect(totals.meetsMinimum).toBe(false);
    expect(totals.missingForMinimumCents).toBe(1500);
  });

  it("cartTotals usa a taxa e o mínimo da loja", () => {
    const totals = cartTotals([line()], "delivery", { deliveryFeeCents: 590, minOrderCents: 2000 });

    expect(totals.subtotalCents).toBe(2500);
    expect(totals.totalCents).toBe(3090);
    expect(totals.meetsMinimum).toBe(true);
  });
});

describe("buildCheckoutInput", () => {
  const address = {
    street: "Rua A",
    number: "10",
    complement: "",
    district: "Centro",
    city: "São Paulo",
    reference: "",
    postalCode: "",
  };

  it("envia endereço no delivery", () => {
    const input = buildCheckoutInput({
      lines: [line()],
      customerName: "Maria",
      customerPhone: "11988887777",
      fulfillmentType: "delivery",
      address,
      paymentMethod: "pix",
      notes: "",
    });

    expect(input.address).toEqual(address);
    expect(input.items).toHaveLength(1);
  });

  it("descarta endereço na retirada", () => {
    const input = buildCheckoutInput({
      lines: [line()],
      customerName: "Maria",
      customerPhone: "11988887777",
      fulfillmentType: "pickup",
      address,
      paymentMethod: "cash",
      notes: "",
    });

    expect(input.address).toBeNull();
  });
});
