import { describe, expect, it } from "vitest";

import {
  categoryInputSchema,
  centsToPriceInput,
  groupSelectionError,
  isGroupCapacityFeasible,
  optionGroupInputSchema,
  optionInputSchema,
  priceToCents,
  productInputSchema,
} from "@/modules/menu/validation";

const CATEGORY_ID = "11111111-1111-4111-8111-111111111111";

describe("priceToCents", () => {
  it("aceita formatos brasileiros e decimais", () => {
    expect(priceToCents("19,90")).toBe(1990);
    expect(priceToCents("19.90")).toBe(1990);
    expect(priceToCents("19")).toBe(1900);
    expect(priceToCents("R$ 25,00")).toBe(2500);
    expect(priceToCents("1.234,56")).toBe(123456);
    expect(priceToCents("0,00")).toBe(0);
  });

  it("rejeita valores inválidos", () => {
    expect(priceToCents("")).toBeNull();
    expect(priceToCents("abc")).toBeNull();
    expect(priceToCents("-5")).toBeNull();
    expect(priceToCents("19,999")).toBeNull();
    expect(priceToCents("1,2,3")).toBeNull();
  });
});

describe("centsToPriceInput", () => {
  it("formata centavos para edição", () => {
    expect(centsToPriceInput(1990)).toBe("19,90");
    expect(centsToPriceInput(0)).toBe("0,00");
    expect(centsToPriceInput(5)).toBe("0,05");
    expect(centsToPriceInput(123456)).toBe("1234,56");
  });
});

describe("categoryInputSchema", () => {
  it("aceita nome e descrição vazia", () => {
    const result = categoryInputSchema.safeParse({ name: "Hambúrgueres", description: "" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeNull();
    }
  });

  it("rejeita nome vazio", () => {
    expect(categoryInputSchema.safeParse({ name: "  ", description: "" }).success).toBe(false);
  });
});

describe("productInputSchema", () => {
  it("converte preço para centavos", () => {
    const result = productInputSchema.safeParse({
      name: "X-Bacon",
      categoryId: CATEGORY_ID,
      description: "Pão, blend e bacon",
      priceCents: "25,00",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priceCents).toBe(2500);
    }
  });

  it("rejeita preço inválido, negativo ou absurdo", () => {
    const base = {
      name: "X-Bacon",
      categoryId: CATEGORY_ID,
      description: "",
    };

    expect(productInputSchema.safeParse({ ...base, priceCents: "abc" }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, priceCents: "-1,00" }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, priceCents: "100000,01" }).success).toBe(false);
  });

  it("rejeita categoria inválida", () => {
    const result = productInputSchema.safeParse({
      name: "X-Bacon",
      categoryId: "categoria",
      description: "",
      priceCents: "10,00",
    });

    expect(result.success).toBe(false);
  });
});

describe("optionGroupInputSchema", () => {
  it("aceita grupo opcional de 0 a 3", () => {
    expect(
      optionGroupInputSchema.safeParse({
        name: "Extras",
        minSelect: "0",
        maxSelect: "3",
        required: false,
      }).success,
    ).toBe(true);
  });

  it("rejeita grupo obrigatório com mínimo zero", () => {
    expect(
      optionGroupInputSchema.safeParse({
        name: "Extras",
        minSelect: "0",
        maxSelect: "3",
        required: true,
      }).success,
    ).toBe(false);
  });

  it("rejeita máximo menor que o mínimo", () => {
    expect(
      optionGroupInputSchema.safeParse({
        name: "Extras",
        minSelect: "3",
        maxSelect: "2",
        required: false,
      }).success,
    ).toBe(false);
  });

  it("rejeita valores acima do limite", () => {
    expect(
      optionGroupInputSchema.safeParse({
        name: "Extras",
        minSelect: "0",
        maxSelect: "21",
        required: false,
      }).success,
    ).toBe(false);
  });
});

describe("optionInputSchema", () => {
  it("trata preço vazio como adicional gratuito", () => {
    const result = optionInputSchema.safeParse({ name: "Ovo", additionalPriceCents: "" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.additionalPriceCents).toBe(0);
    }
  });

  it("converte preço extra", () => {
    const result = optionInputSchema.safeParse({ name: "Bacon", additionalPriceCents: "4,00" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.additionalPriceCents).toBe(400);
    }
  });

  it("rejeita preço extra acima do limite", () => {
    expect(
      optionInputSchema.safeParse({ name: "Bacon", additionalPriceCents: "10000,01" }).success,
    ).toBe(false);
  });
});

describe("isGroupCapacityFeasible", () => {
  it("exige opções suficientes para o máximo e o mínimo", () => {
    expect(isGroupCapacityFeasible(0, 3, 3)).toBe(true);
    expect(isGroupCapacityFeasible(1, 3, 3)).toBe(true);
    expect(isGroupCapacityFeasible(0, 3, 2)).toBe(false);
    expect(isGroupCapacityFeasible(2, 3, 1)).toBe(false);
    expect(isGroupCapacityFeasible(0, 1, 0)).toBe(false);
  });
});

describe("groupSelectionError", () => {
  const group = { name: "Extras", minSelect: 1, maxSelect: 2 };

  it("valida mínimo e máximo", () => {
    expect(groupSelectionError(group, 0)).toContain("pelo menos 1");
    expect(groupSelectionError(group, 3)).toContain("no máximo 2");
    expect(groupSelectionError(group, 1)).toBeNull();
    expect(groupSelectionError(group, 2)).toBeNull();
  });
});
