import { z } from "zod";

import { formatCurrency } from "@/lib/utils";
import {
  MAX_OPTION_PRICE_CENTS,
  MAX_PRODUCT_PRICE_CENTS,
  MAX_SELECTION,
} from "@/modules/menu/constants";

export function priceToCents(value: string): number | null {
  const cleaned = value
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/\s+/g, "");

  if (!cleaned) {
    return null;
  }

  let normalized = cleaned;

  if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, "");
  }

  const match = normalized.match(/^(\d{1,7})(?:\.(\d{1,2}))?$/);

  if (!match) {
    return null;
  }

  const reais = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0"));

  if (!Number.isSafeInteger(reais) || !Number.isSafeInteger(cents)) {
    return null;
  }

  return reais * 100 + cents;
}

export function centsToPriceInput(cents: number): string {
  const reais = Math.floor(cents / 100);
  const remainder = cents % 100;
  return `${reais},${String(remainder).padStart(2, "0")}`;
}

function moneyField(maxCents: number, requiredMessage: string, allowEmpty = false) {
  return z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value === "" && allowEmpty) {
        return 0;
      }

      if (value === "") {
        ctx.addIssue({ code: "custom", message: requiredMessage });
        return z.NEVER;
      }

      const cents = priceToCents(value);

      if (cents === null) {
        ctx.addIssue({ code: "custom", message: "Informe um preço válido (ex.: 19,90)." });
        return z.NEVER;
      }

      if (cents > maxCents) {
        ctx.addIssue({
          code: "custom",
          message: `O preço máximo é ${formatCurrency(maxCents)}.`,
        });
        return z.NEVER;
      }

      return cents;
    });
}

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value === "" ? null : value));

export const categoryInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome da categoria.")
    .max(120, "O nome deve ter no máximo 120 caracteres."),
  description: optionalText(500, "A descrição deve ter no máximo 500 caracteres."),
});

export const productInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Informe o nome do produto.")
    .max(160, "O nome deve ter no máximo 160 caracteres."),
  categoryId: z.uuid("Selecione uma categoria válida."),
  description: optionalText(1000, "A descrição deve ter no máximo 1000 caracteres."),
  priceCents: moneyField(MAX_PRODUCT_PRICE_CENTS, "Informe o preço do produto."),
});

export const optionGroupInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Informe o nome do grupo.")
      .max(120, "O nome deve ter no máximo 120 caracteres."),
    minSelect: z.coerce
      .number()
      .int("O mínimo deve ser um número inteiro.")
      .min(0, "O mínimo não pode ser negativo.")
      .max(MAX_SELECTION, `O mínimo máximo é ${MAX_SELECTION}.`),
    maxSelect: z.coerce
      .number()
      .int("O máximo deve ser um número inteiro.")
      .min(1, "O máximo deve ser pelo menos 1.")
      .max(MAX_SELECTION, `O máximo máximo é ${MAX_SELECTION}.`),
    required: z.boolean(),
  })
  .refine((data) => data.maxSelect >= data.minSelect, {
    path: ["maxSelect"],
    message: "O máximo deve ser maior ou igual ao mínimo.",
  })
  .refine((data) => !data.required || data.minSelect >= 1, {
    path: ["minSelect"],
    message: "Grupos obrigatórios precisam de seleção mínima de pelo menos 1.",
  });

export const optionInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome do adicional.")
    .max(120, "O nome deve ter no máximo 120 caracteres."),
  additionalPriceCents: moneyField(MAX_OPTION_PRICE_CENTS, "Informe o preço extra.", true),
});

export function isGroupCapacityFeasible(
  minSelect: number,
  maxSelect: number,
  availableOptions: number,
): boolean {
  return availableOptions > 0 && availableOptions >= minSelect && availableOptions >= maxSelect;
}

export function groupSelectionError(
  group: { name: string; minSelect: number; maxSelect: number },
  selectedCount: number,
): string | null {
  if (selectedCount < group.minSelect) {
    return `Selecione pelo menos ${group.minSelect} opção(ões) em "${group.name}".`;
  }

  if (selectedCount > group.maxSelect) {
    return `Selecione no máximo ${group.maxSelect} opção(ões) em "${group.name}".`;
  }

  return null;
}

export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type ProductInput = z.infer<typeof productInputSchema>;
export type OptionGroupInput = z.infer<typeof optionGroupInputSchema>;
export type OptionInput = z.infer<typeof optionInputSchema>;
