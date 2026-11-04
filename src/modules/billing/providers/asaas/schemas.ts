import { z } from "zod";

export const asaasCustomerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    email: z.string().nullish(),
    cpfCnpj: z.string().nullish(),
    externalReference: z.string().nullish(),
  })
  .passthrough();

export const asaasCustomerListSchema = z
  .object({
    data: z.array(asaasCustomerSchema),
    hasMore: z.boolean().optional(),
    totalCount: z.number().optional(),
  })
  .passthrough();

export const asaasSubscriptionSchema = z
  .object({
    id: z.string().min(1),
    customer: z.string().min(1),
    billingType: z.string().min(1),
    value: z.coerce.number().nonnegative(),
    nextDueDate: z.string().min(1),
    cycle: z.string().min(1),
    status: z.string().min(1),
    externalReference: z.string().nullish(),
    description: z.string().nullish(),
  })
  .passthrough();

export const asaasSubscriptionListSchema = z
  .object({
    data: z.array(asaasSubscriptionSchema),
    hasMore: z.boolean().optional(),
    totalCount: z.number().optional(),
  })
  .passthrough();

export const asaasPaymentSchema = z
  .object({
    id: z.string().min(1),
    customer: z.string().min(1),
    subscription: z.string().nullish(),
    billingType: z.string().min(1),
    value: z.coerce.number().nonnegative(),
    status: z.string().min(1),
    dueDate: z.string().min(1),
    paymentDate: z.string().nullish(),
    confirmedDate: z.string().nullish(),
    clientPaymentDate: z.string().nullish(),
    invoiceUrl: z.string().nullish(),
    bankSlipUrl: z.string().nullish(),
    externalReference: z.string().nullish(),
    description: z.string().nullish(),
    deleted: z.boolean().optional().default(false),
  })
  .passthrough();

export const asaasPaymentListSchema = z
  .object({
    data: z.array(asaasPaymentSchema),
    hasMore: z.boolean().optional(),
    totalCount: z.number().optional(),
  })
  .passthrough();

export const asaasPixQrCodeSchema = z
  .object({
    encodedImage: z.string().min(1),
    payload: z.string().min(1).max(4_000),
    expirationDate: z.string().nullish(),
  })
  .passthrough();

export const asaasErrorSchema = z
  .object({
    errors: z
      .array(
        z
          .object({
            code: z.string().nullish(),
            description: z.string().nullish(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export type AsaasCustomerDto = z.infer<typeof asaasCustomerSchema>;
export type AsaasSubscriptionDto = z.infer<typeof asaasSubscriptionSchema>;
export type AsaasPaymentDto = z.infer<typeof asaasPaymentSchema>;
export type AsaasPixQrCodeDto = z.infer<typeof asaasPixQrCodeSchema>;
