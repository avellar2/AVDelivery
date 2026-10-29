import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .pipe(z.email("Informe um e-mail válido."));

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1, "Informe sua senha.")
    .max(72, "A senha deve ter no máximo 72 caracteres."),
});

export const emailOnlySchema = z.object({
  email: emailSchema,
});

export const newPasswordSchema = z
  .string()
  .min(8, "A senha deve ter pelo menos 8 caracteres.")
  .max(72, "A senha deve ter no máximo 72 caracteres.")
  .regex(/[A-Za-z]/, "Inclua ao menos uma letra.")
  .regex(/[0-9]/, "Inclua ao menos um número.");

export const resetPasswordSchema = z
  .object({
    password: newPasswordSchema,
    confirmPassword: z.string().min(1, "Confirme a nova senha."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não coincidem.",
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
