import { describe, expect, it } from "vitest";

import { hashCheckoutPayload, sha256Hex, stableStringify } from "@/modules/orders/hashing";
import { canonicalizeCheckout } from "@/modules/orders/payload";
import type { CheckoutInput } from "@/modules/orders/types";

const ITEM_A = "11111111-1111-4111-8111-111111111111";
const ITEM_B = "22222222-2222-4222-8222-222222222222";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
const OPTION_1 = "44444444-4444-4444-8444-444444444444";
const OPTION_2 = "55555555-5555-4555-8555-555555555555";

function checkout(overrides: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    customerName: "  Maria Souza  ",
    customerPhone: "11988887777",
    fulfillmentType: "delivery",
    address: {
      street: " Rua A ",
      number: " 10 ",
      complement: " ",
      district: "Centro",
      city: "São Paulo",
      reference: "",
      postalCode: "",
    },
    paymentMethod: "pix",
    notes: "  sem cebola  ",
    items: [
      {
        productId: ITEM_A,
        quantity: 1,
        notes: "  sem molho ",
        options: [
          { groupId: GROUP_ID, optionId: OPTION_2, quantity: 1 },
          { groupId: GROUP_ID, optionId: OPTION_1, quantity: 1 },
        ],
      },
    ],
    ...overrides,
  };
}

describe("canonicalizeCheckout", () => {
  it("remove espaços e ordena itens e adicionais", () => {
    const canonical = canonicalizeCheckout(checkout());

    expect(canonical.customerName).toBe("Maria Souza");
    expect(canonical.notes).toBe("sem cebola");
    expect(canonical.address?.street).toBe("Rua A");
    expect(canonical.address?.complement).toBe("");
    expect(canonical.items[0]?.notes).toBe("sem molho");
    expect(canonical.items[0]?.options.map((option) => option.optionId)).toEqual([
      OPTION_1,
      OPTION_2,
    ]);
  });

  it("produz o mesmo payload para a mesma tentativa", () => {
    const first = canonicalizeCheckout(checkout());
    const second = canonicalizeCheckout(checkout());

    expect(hashCheckoutPayload(first)).toBe(hashCheckoutPayload(second));
  });

  it("produz hashes diferentes quando o conteúdo muda", () => {
    const base = hashCheckoutPayload(canonicalizeCheckout(checkout()));
    const otherQuantity = hashCheckoutPayload(
      canonicalizeCheckout(
        checkout({
          items: [{ productId: ITEM_A, quantity: 2, notes: "sem molho", options: [] }],
        }),
      ),
    );

    expect(base).not.toBe(otherQuantity);
  });

  it("ordena itens pelo produto", () => {
    const canonical = canonicalizeCheckout(
      checkout({
        items: [
          { productId: ITEM_B, quantity: 1, notes: "", options: [] },
          { productId: ITEM_A, quantity: 1, notes: "", options: [] },
        ],
      }),
    );

    expect(canonical.items.map((item) => item.productId)).toEqual([ITEM_A, ITEM_B]);
  });
});

describe("hashing", () => {
  it("gera sha256 conhecido", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("ordena chaves do objeto no stableStringify", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});
