import { describe, expect, it } from "vitest";

import {
  checkoutInputSchema,
  idempotencyKeySchema,
  trackingTokenSchema,
} from "@/modules/orders/validation";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_ID = "22222222-2222-4222-8222-222222222222";
const OPTION_ID = "33333333-3333-4333-8333-333333333333";

const address = {
  street: "Rua das Flores",
  number: "120",
  complement: "Apto 4",
  district: "Centro",
  city: "São Paulo",
  reference: "",
  postalCode: "01000-000",
};

function checkout(overrides: Record<string, unknown> = {}) {
  return {
    customerName: "Maria Souza",
    customerPhone: "(11) 98888-7777",
    fulfillmentType: "delivery",
    address,
    paymentMethod: "pix",
    notes: "",
    items: [{ productId: PRODUCT_ID, quantity: 1, notes: "", options: [] }],
    ...overrides,
  };
}

describe("checkoutInputSchema", () => {
  it("aceita um pedido de entrega válido e normaliza o telefone", () => {
    const result = checkoutInputSchema.safeParse(checkout());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customerPhone).toBe("11988887777");
      expect(result.data.address?.street).toBe("Rua das Flores");
    }
  });

  it("exige endereço quando a entrega é escolhida", () => {
    const result = checkoutInputSchema.safeParse(checkout({ address: null }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("address"))).toBe(true);
    }
  });

  it("ignora endereço na retirada", () => {
    const result = checkoutInputSchema.safeParse(checkout({ fulfillmentType: "pickup" }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.address).toBeNull();
    }
  });

  it("rejeita telefone sem DDD", () => {
    const result = checkoutInputSchema.safeParse(checkout({ customerPhone: "9999-0000" }));

    expect(result.success).toBe(false);
  });

  it("rejeita carrinho vazio", () => {
    const result = checkoutInputSchema.safeParse(checkout({ items: [] }));

    expect(result.success).toBe(false);
  });

  it("rejeita quantidade fora do limite", () => {
    const zero = checkoutInputSchema.safeParse(
      checkout({ items: [{ productId: PRODUCT_ID, quantity: 0, notes: "", options: [] }] }),
    );
    const tooMany = checkoutInputSchema.safeParse(
      checkout({ items: [{ productId: PRODUCT_ID, quantity: 100, notes: "", options: [] }] }),
    );

    expect(zero.success).toBe(false);
    expect(tooMany.success).toBe(false);
  });

  it("rejeita adicional repetido no mesmo item", () => {
    const result = checkoutInputSchema.safeParse(
      checkout({
        items: [
          {
            productId: PRODUCT_ID,
            quantity: 1,
            notes: "",
            options: [
              { groupId: GROUP_ID, optionId: OPTION_ID, quantity: 1 },
              { groupId: GROUP_ID, optionId: OPTION_ID, quantity: 1 },
            ],
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) =>
            issue.path.includes("items") &&
            issue.path.includes("options") &&
            issue.path.includes("optionId"),
        ),
      ).toBe(true);
    }
  });

  it("rejeita observação acima do limite", () => {
    const result = checkoutInputSchema.safeParse(checkout({ notes: "a".repeat(501) }));

    expect(result.success).toBe(false);
  });

  it("rejeita forma de pagamento desconhecida", () => {
    const result = checkoutInputSchema.safeParse(checkout({ paymentMethod: "credit_card" }));

    expect(result.success).toBe(false);
  });
});

describe("chaves do checkout", () => {
  it("aceita chave de idempotência alfanumérica", () => {
    expect(idempotencyKeySchema.safeParse("9f2c1a7b4d8e").success).toBe(true);
    expect(idempotencyKeySchema.safeParse("abc").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("chave com espaço").success).toBe(false);
  });

  it("exige token de acompanhamento com 64 caracteres hexadecimais", () => {
    expect(trackingTokenSchema.safeParse("a".repeat(64)).success).toBe(true);
    expect(trackingTokenSchema.safeParse("a".repeat(63)).success).toBe(false);
    expect(trackingTokenSchema.safeParse("z".repeat(64)).success).toBe(false);
  });
});
