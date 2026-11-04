import { z } from "zod";

export function onlyDigits(value: string): string {
  return value.replace(/\D+/g, "");
}

export function isValidCpf(value: string): boolean {
  const digits = onlyDigits(value);

  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) {
    return false;
  }

  const check = (length: number): number => {
    let sum = 0;

    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * (length + 1 - index);
    }

    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

export function isValidCnpj(value: string): boolean {
  const digits = onlyDigits(value);

  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) {
    return false;
  }

  const check = (length: number): number => {
    const weights =
      length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;

    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * weights[index];
    }

    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  return check(12) === Number(digits[12]) && check(13) === Number(digits[13]);
}

export function isValidCpfOrCnpj(value: string): boolean {
  const digits = onlyDigits(value);
  return isValidCpf(digits) || isValidCnpj(digits);
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use no máximo ${max} caracteres.`)
    .transform((value) => (value === "" ? null : value));

export const billingProfileSchema = z
  .object({
    legalName: z
      .string()
      .trim()
      .min(2, "Informe a razão social ou nome completo.")
      .max(160, "O nome deve ter no máximo 160 caracteres."),
    document: z
      .string()
      .transform(onlyDigits)
      .refine(
        (value) => isValidCpfOrCnpj(value),
        "Informe um CPF ou CNPJ válido (somente números).",
      ),
    email: z.email("Informe um e-mail financeiro válido.").max(254),
    phone: z
      .string()
      .transform(onlyDigits)
      .refine(
        (value) => /^[1-9]{2}9?[0-9]{8}$/.test(value),
        "Informe um celular ou telefone com DDD.",
      ),
    postalCode: z
      .string()
      .transform(onlyDigits)
      .refine(
        (value) => value === "" || /^[0-9]{8}$/.test(value),
        "Informe um CEP com 8 números ou deixe em branco.",
      )
      .transform((value) => (value === "" ? null : value)),
    address: optionalText(200),
    addressNumber: optionalText(20),
    complement: optionalText(120),
    province: optionalText(80),
  })
  .superRefine((value, context) => {
    if (value.address && !value.addressNumber) {
      context.addIssue({
        code: "custom",
        path: ["addressNumber"],
        message: "Informe o número do endereço ou deixe o endereço em branco.",
      });
    }
  });

export type BillingProfileInput = z.infer<typeof billingProfileSchema>;

export const checkoutRequestSchema = z.object({
  requestId: z.uuid("Requisição inválida. Recarregue a página."),
});

export const refreshChargeSchema = z.object({
  requestId: z.uuid("Requisição inválida. Recarregue a página."),
});
