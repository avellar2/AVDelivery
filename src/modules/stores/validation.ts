import { z } from "zod";

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

export const storeSettingsSchema = z.object({
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
});

export type StoreSettingsInput = z.infer<typeof storeSettingsSchema>;
