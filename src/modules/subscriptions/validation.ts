import { z } from "zod";

export const subscriptionActionValues = [
  "start_trial",
  "activate",
  "grant_grace",
  "expire",
  "cancel",
  "set_exempt",
  "remove_exempt",
  "change_plan",
] as const;

export type SubscriptionAction = (typeof subscriptionActionValues)[number];

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value === "" ? null : value));

const optionalDays = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === undefined || value === "" ? null : Number(value)))
  .refine((value) => value === null || (Number.isInteger(value) && value >= 1 && value <= 366), {
    message: "Informe um número de dias entre 1 e 366.",
  });

export const createStoreSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Informe o nome do estabelecimento.")
    .max(120, "O nome deve ter no máximo 120 caracteres."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "O identificador deve ter pelo menos 3 caracteres.")
    .max(80, "O identificador deve ter no máximo 80 caracteres.")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use apenas letras minúsculas, números e hífens."),
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
  ownerEmail: z.email("Informe um e-mail válido para o proprietário."),
  planId: z.uuid("Selecione um plano válido."),
  startTrial: z.boolean(),
  requestId: z.uuid("Requisição inválida. Recarregue a página."),
});

export type CreateStoreInput = z.infer<typeof createStoreSchema>;

export const updateStoreSchema = z.object({
  storeId: z.uuid("Loja inválida."),
  name: z
    .string()
    .trim()
    .min(2, "Informe o nome do estabelecimento.")
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
  active: z.boolean(),
  reason: optionalText(500, "O motivo deve ter no máximo 500 caracteres."),
  requestId: z.uuid("Requisição inválida. Recarregue a página."),
});

export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;

export const subscriptionActionSchema = z.object({
  storeId: z.uuid("Loja inválida."),
  action: z.enum(subscriptionActionValues),
  days: optionalDays,
  planId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === "" ? null : value))
    .refine((value) => value === null || z.uuid().safeParse(value).success, {
      message: "Plano inválido.",
    }),
  reason: z
    .string()
    .trim()
    .min(3, "Informe o motivo da ação (mínimo de 3 caracteres).")
    .max(500, "O motivo deve ter no máximo 500 caracteres."),
  requestId: z.uuid("Requisição inválida. Recarregue a página."),
});

export type SubscriptionActionInput = z.infer<typeof subscriptionActionSchema>;

export const addStoreOwnerSchema = z.object({
  storeId: z.uuid("Loja inválida."),
  ownerEmail: z.email("Informe um e-mail válido."),
  reason: z
    .string()
    .trim()
    .min(3, "Informe o motivo do vínculo (mínimo de 3 caracteres).")
    .max(500, "O motivo deve ter no máximo 500 caracteres."),
  requestId: z.uuid("Requisição inválida. Recarregue a página."),
});

export type AddStoreOwnerInput = z.infer<typeof addStoreOwnerSchema>;
