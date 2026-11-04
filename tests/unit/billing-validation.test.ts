import { describe, expect, it } from "vitest";

import {
  billingProfileSchema,
  isValidCnpj,
  isValidCpf,
  isValidCpfOrCnpj,
  onlyDigits,
} from "@/modules/billing/validation";

const validProfile = {
  legalName: "Loja Exemplo Ltda",
  document: "11222333000181",
  email: "financeiro@example.com",
  phone: "(11) 91234-5678",
  postalCode: "01001-000",
  address: "Praça da Sé",
  addressNumber: "1",
  complement: "",
  province: "Centro",
};

describe("CPF e CNPJ", () => {
  it("aceita documentos válidos", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCpfOrCnpj("52998224725")).toBe(true);
    expect(isValidCpfOrCnpj("11222333000181")).toBe(true);
  });

  it("rejeita documentos inválidos, repetidos ou com tamanho errado", () => {
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCpfOrCnpj("123")).toBe(false);
  });

  it("normaliza apenas dígitos", () => {
    expect(onlyDigits("(11) 91234-5678")).toBe("11912345678");
  });
});

describe("validação do perfil de faturamento", () => {
  it("normaliza documento, telefone e CEP", () => {
    const parsed = billingProfileSchema.safeParse(validProfile);
    expect(parsed.success).toBe(true);

    if (parsed.success) {
      expect(parsed.data).toMatchObject({
        document: "11222333000181",
        phone: "11912345678",
        postalCode: "01001000",
        complement: null,
      });
    }
  });

  it("exige documento, e-mail e telefone válidos", () => {
    const parsed = billingProfileSchema.safeParse({
      ...validProfile,
      document: "123",
      email: "invalido",
      phone: "123",
    });

    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => issue.path.join("."));
      expect(fields).toEqual(expect.arrayContaining(["document", "email", "phone"]));
    }
  });

  it("exige número quando um endereço é informado", () => {
    const parsed = billingProfileSchema.safeParse({
      ...validProfile,
      addressNumber: "",
    });

    expect(parsed.success).toBe(false);

    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.includes("addressNumber"))).toBe(true);
    }
  });

  it("aceita endereço vazio, pois é opcional", () => {
    const parsed = billingProfileSchema.safeParse({
      ...validProfile,
      postalCode: "",
      address: "",
      addressNumber: "",
      complement: "",
      province: "",
    });

    expect(parsed.success).toBe(true);
  });

  it("recusa CEP inválido", () => {
    const parsed = billingProfileSchema.safeParse({ ...validProfile, postalCode: "123" });
    expect(parsed.success).toBe(false);
  });
});
