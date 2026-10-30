import { z } from "zod";

import {
  MAX_ADDRESS_FIELD,
  MAX_ITEM_NOTES,
  MAX_ITEM_QUANTITY,
  MAX_ORDER_ITEMS,
  MAX_ORDER_ITEM_OPTIONS,
  MAX_ORDER_NOTES,
} from "@/modules/orders/constants";

const phoneSchema = z
  .string()
  .trim()
  .max(30, "O telefone deve ter no máximo 30 caracteres.")
  .transform((value) => value.replace(/[^0-9]/g, ""))
  .refine(
    (value) => /^[0-9]{10,15}$/.test(value),
    "Informe um telefone válido com DDD (10 a 15 dígitos).",
  );

const optionalShortText = (max: number, message: string) =>
  z.string().trim().max(max, message).optional().default("");

export const checkoutAddressSchema = z.object({
  street: z
    .string()
    .trim()
    .min(1, "Informe a rua.")
    .max(MAX_ADDRESS_FIELD, "A rua deve ter no máximo 160 caracteres."),
  number: z
    .string()
    .trim()
    .min(1, "Informe o número.")
    .max(30, "O número deve ter no máximo 30 caracteres."),
  complement: optionalShortText(120, "O complemento deve ter no máximo 120 caracteres."),
  district: z
    .string()
    .trim()
    .min(1, "Informe o bairro.")
    .max(120, "O bairro deve ter no máximo 120 caracteres."),
  city: z
    .string()
    .trim()
    .min(1, "Informe a cidade.")
    .max(120, "A cidade deve ter no máximo 120 caracteres."),
  reference: optionalShortText(200, "A referência deve ter no máximo 200 caracteres."),
  postalCode: optionalShortText(20, "O CEP deve ter no máximo 20 caracteres."),
});

export const checkoutOptionSchema = z.object({
  groupId: z.uuid("Grupo de adicional inválido."),
  optionId: z.uuid("Adicional inválido."),
  quantity: z.coerce
    .number()
    .int("A quantidade deve ser inteira.")
    .min(1, "A quantidade mínima é 1.")
    .max(MAX_ITEM_QUANTITY, `A quantidade máxima é ${MAX_ITEM_QUANTITY}.`)
    .default(1),
});

export const checkoutItemSchema = z.object({
  productId: z.uuid("Produto inválido."),
  quantity: z.coerce
    .number()
    .int("A quantidade deve ser inteira.")
    .min(1, "A quantidade mínima é 1.")
    .max(MAX_ITEM_QUANTITY, `A quantidade máxima é ${MAX_ITEM_QUANTITY}.`),
  notes: optionalShortText(MAX_ITEM_NOTES, "A observação deve ter no máximo 300 caracteres."),
  options: z
    .array(checkoutOptionSchema)
    .max(MAX_ORDER_ITEM_OPTIONS, `Selecione no máximo ${MAX_ORDER_ITEM_OPTIONS} adicionais.`)
    .default([]),
});

export const checkoutInputSchema = z
  .object({
    customerName: z
      .string()
      .trim()
      .min(2, "Informe seu nome.")
      .max(120, "O nome deve ter no máximo 120 caracteres."),
    customerPhone: phoneSchema,
    fulfillmentType: z.enum(["delivery", "pickup"], "Escolha entrega ou retirada."),
    address: checkoutAddressSchema.nullable().optional(),
    paymentMethod: z.enum(
      ["pix", "cash", "card_on_delivery"],
      "Escolha uma forma de pagamento válida.",
    ),
    notes: optionalShortText(MAX_ORDER_NOTES, "A observação deve ter no máximo 500 caracteres."),
    items: z
      .array(checkoutItemSchema)
      .min(1, "Adicione pelo menos um produto ao carrinho.")
      .max(MAX_ORDER_ITEMS, `O pedido aceita no máximo ${MAX_ORDER_ITEMS} itens.`),
  })
  .superRefine((data, ctx) => {
    if (data.fulfillmentType === "delivery" && !data.address) {
      ctx.addIssue({
        code: "custom",
        path: ["address"],
        message: "Informe o endereço de entrega.",
      });
    }

    data.items.forEach((item, itemIndex) => {
      const seen = new Set<string>();

      item.options.forEach((option, optionIndex) => {
        if (seen.has(option.optionId)) {
          ctx.addIssue({
            code: "custom",
            path: ["items", itemIndex, "options", optionIndex, "optionId"],
            message: "Este adicional foi selecionado mais de uma vez.",
          });
        }

        seen.add(option.optionId);
      });
    });
  })
  .transform((data) => ({
    ...data,
    address: data.fulfillmentType === "delivery" ? (data.address ?? null) : null,
  }));

export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,100}$/, "Chave de idempotência inválida.");

export const trackingTokenSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Token de acompanhamento inválido.");

export const orderNumberSchema = z.coerce.number().int().min(1);

export type CheckoutInputParsed = z.infer<typeof checkoutInputSchema>;
