import { z } from "zod";

import { formatCurrency } from "@/lib/utils";
import { priceToCents } from "@/modules/menu/validation";

export const storeSlugSchema = z
  .string()
  .trim()
  .min(3, "O identificador deve ter pelo menos 3 caracteres.")
  .max(80, "O identificador deve ter no máximo 80 caracteres.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use apenas letras minúsculas, números e hífens simples.");

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value === "" ? null : value));

const MAX_DELIVERY_FEE_CENTS = 1_000_000;
const MAX_MIN_ORDER_CENTS = 10_000_000;

function moneyField(maxCents: number, message: string) {
  return z
    .string()
    .trim()
    .transform((value, ctx) => {
      const cents = priceToCents(value === "" ? "0" : value);

      if (cents === null) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }

      if (cents > maxCents) {
        ctx.addIssue({
          code: "custom",
          message: `O valor máximo é ${formatCurrency(maxCents)}.`,
        });
        return z.NEVER;
      }

      return cents;
    });
}

export const storeSettingsSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Informe o nome da loja.")
      .max(120, "O nome deve ter no máximo 120 caracteres."),
    description: optionalText(500, "A descrição deve ter no máximo 500 caracteres."),
    phone: z
      .string()
      .trim()
      .max(30, "O telefone deve ter no máximo 30 caracteres.")
      .refine(
        (value) => value === "" || /^[0-9()+\-\s]{8,30}$/.test(value),
        "Informe um telefone válido.",
      )
      .transform((value) => (value === "" ? null : value)),
    logoUrl: z
      .string()
      .trim()
      .max(500, "A URL do logo deve ter no máximo 500 caracteres.")
      .refine((value) => {
        if (value === "") {
          return true;
        }

        try {
          const parsed = new URL(value);
          return parsed.protocol === "https:" || parsed.protocol === "http:";
        } catch {
          return false;
        }
      }, "Informe uma URL válida começando com http:// ou https://.")
      .transform((value) => (value === "" ? null : value)),
    acceptingOrders: z.boolean(),
    deliveryEnabled: z.boolean(),
    pickupEnabled: z.boolean(),
    deliveryFeeCents: moneyField(
      MAX_DELIVERY_FEE_CENTS,
      "Informe uma taxa de entrega válida (ex.: 5,90).",
    ),
    minOrderCents: moneyField(MAX_MIN_ORDER_CENTS, "Informe um pedido mínimo válido (ex.: 20,00)."),
    paymentPixEnabled: z.boolean(),
    paymentCashEnabled: z.boolean(),
    paymentCardOnDeliveryEnabled: z.boolean(),
    pixKey: optionalText(200, "A chave Pix deve ter no máximo 200 caracteres."),
    pixReceiverName: optionalText(120, "O nome do recebedor deve ter no máximo 120 caracteres."),
  })
  .superRefine((data, ctx) => {
    if (!data.deliveryEnabled && !data.pickupEnabled) {
      ctx.addIssue({
        code: "custom",
        path: ["fulfillment"],
        message: "Habilite pelo menos uma forma de recebimento: entrega ou retirada.",
      });
    }

    if (!data.paymentPixEnabled && !data.paymentCashEnabled && !data.paymentCardOnDeliveryEnabled) {
      ctx.addIssue({
        code: "custom",
        path: ["payments"],
        message: "Habilite pelo menos uma forma de pagamento.",
      });
    }

    if (data.paymentPixEnabled && !data.pixKey) {
      ctx.addIssue({
        code: "custom",
        path: ["pixKey"],
        message: "Informe a chave Pix para aceitar pagamento via Pix manual.",
      });
    }
  });

export type StoreSettingsInput = z.infer<typeof storeSettingsSchema>;
