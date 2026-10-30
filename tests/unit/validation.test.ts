import { describe, expect, it } from "vitest";

import { loginSchema, resetPasswordSchema } from "@/modules/auth/validation";
import { storeSettingsSchema, storeSlugSchema } from "@/modules/stores/validation";

describe("loginSchema", () => {
  it("normaliza o e-mail", () => {
    const result = loginSchema.safeParse({ email: "  USER@Example.com ", password: "123456" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("user@example.com");
    }
  });

  it("rejeita e-mail inválido", () => {
    const result = loginSchema.safeParse({ email: "invalido", password: "123456" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Informe um e-mail válido.");
    }
  });

  it("rejeita senha vazia", () => {
    const result = loginSchema.safeParse({ email: "user@example.com", password: "" });

    expect(result.success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("aceita senha forte e confirmação igual", () => {
    const result = resetPasswordSchema.safeParse({
      password: "Senha-forte-123",
      confirmPassword: "Senha-forte-123",
    });

    expect(result.success).toBe(true);
  });

  it("rejeita senha sem número", () => {
    const result = resetPasswordSchema.safeParse({
      password: "somenteletras",
      confirmPassword: "somenteletras",
    });

    expect(result.success).toBe(false);
  });

  it("rejeita confirmação divergente", () => {
    const result = resetPasswordSchema.safeParse({
      password: "Senha-forte-123",
      confirmPassword: "Outra-senha-456",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("confirmPassword"))).toBe(
        true,
      );
    }
  });
});

describe("storeSettingsSchema", () => {
  const checkoutSettings = {
    acceptingOrders: true,
    deliveryEnabled: true,
    pickupEnabled: true,
    deliveryFeeCents: "5,90",
    minOrderCents: "20,00",
    paymentPixEnabled: false,
    paymentCashEnabled: true,
    paymentCardOnDeliveryEnabled: false,
    pixKey: "",
    pixReceiverName: "",
  };

  it("aceita dados válidos e converte campos vazios em null", () => {
    const result = storeSettingsSchema.safeParse({
      ...checkoutSettings,
      name: "Burger do Bairro",
      description: "",
      phone: "(11) 90000-0000",
      logoUrl: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeNull();
      expect(result.data.logoUrl).toBeNull();
      expect(result.data.phone).toBe("(11) 90000-0000");
      expect(result.data.deliveryFeeCents).toBe(590);
      expect(result.data.minOrderCents).toBe(2000);
    }
  });

  it("aceita logo https", () => {
    const result = storeSettingsSchema.safeParse({
      ...checkoutSettings,
      name: "Loja Válida",
      description: "",
      phone: "",
      logoUrl: "https://exemplo.com/logo.png",
    });

    expect(result.success).toBe(true);
  });

  it("rejeita nome curto", () => {
    const result = storeSettingsSchema.safeParse({
      ...checkoutSettings,
      name: "A",
      description: "",
      phone: "",
      logoUrl: "",
    });

    expect(result.success).toBe(false);
  });

  it("rejeita telefone inválido", () => {
    const result = storeSettingsSchema.safeParse({
      ...checkoutSettings,
      name: "Loja Válida",
      description: "",
      phone: "ligar depois",
      logoUrl: "",
    });

    expect(result.success).toBe(false);
  });

  it("rejeita logo com protocolo não permitido", () => {
    const result = storeSettingsSchema.safeParse({
      ...checkoutSettings,
      name: "Loja Válida",
      description: "",
      phone: "",
      logoUrl: "ftp://exemplo.com/logo.png",
    });

    expect(result.success).toBe(false);
  });
});

describe("storeSlugSchema", () => {
  it("aceita slug em kebab-case", () => {
    expect(storeSlugSchema.safeParse("burger-do-bairro").success).toBe(true);
  });

  it("rejeita maiúsculas e caracteres inválidos", () => {
    expect(storeSlugSchema.safeParse("Burger").success).toBe(false);
    expect(storeSlugSchema.safeParse("burger_do_bairro").success).toBe(false);
    expect(storeSlugSchema.safeParse("-burger").success).toBe(false);
  });
});
