import type { AsaasConfig } from "./config";
import { AsaasError } from "./errors";
import { AsaasHttpClient, type AsaasHttpOptions } from "./http";
import { centsToAsaasValue, safeInvoiceUrl } from "./money";
import {
  asaasCustomerListSchema,
  asaasCustomerSchema,
  asaasPaymentListSchema,
  asaasPaymentSchema,
  asaasPixQrCodeSchema,
  asaasSubscriptionListSchema,
  asaasSubscriptionSchema,
  type AsaasCustomerDto,
  type AsaasPaymentDto,
  type AsaasSubscriptionDto,
} from "./schemas";
import type {
  AsaasCustomer,
  AsaasCustomerInput,
  AsaasPayment,
  AsaasPixQrCode,
  AsaasSubscription,
  AsaasSubscriptionInput,
} from "./types";

function toCustomer(dto: AsaasCustomerDto): AsaasCustomer {
  return {
    id: dto.id,
    name: dto.name,
    email: dto.email ?? null,
    cpfCnpj: dto.cpfCnpj ?? null,
    externalReference: dto.externalReference ?? null,
  };
}

function toSubscription(dto: AsaasSubscriptionDto): AsaasSubscription {
  return {
    id: dto.id,
    customer: dto.customer,
    billingType: dto.billingType,
    value: dto.value,
    nextDueDate: dto.nextDueDate,
    cycle: dto.cycle,
    status: dto.status,
    externalReference: dto.externalReference ?? null,
    description: dto.description ?? null,
  };
}

export function toPayment(dto: AsaasPaymentDto): AsaasPayment {
  return {
    id: dto.id,
    customer: dto.customer,
    subscription: dto.subscription ?? null,
    billingType: dto.billingType,
    value: dto.value,
    status: dto.status,
    dueDate: dto.dueDate,
    paymentDate: dto.paymentDate ?? null,
    confirmedDate: dto.confirmedDate ?? null,
    clientPaymentDate: dto.clientPaymentDate ?? null,
    invoiceUrl: dto.invoiceUrl ?? null,
    bankSlipUrl: dto.bankSlipUrl ?? null,
    externalReference: dto.externalReference ?? null,
    description: dto.description ?? null,
    deleted: dto.deleted === true,
  };
}

export class AsaasClientCore {
  private readonly http: AsaasHttpClient;

  constructor(config: AsaasConfig, options: AsaasHttpOptions = {}) {
    this.http = new AsaasHttpClient(config, options);
  }

  async findCustomerByExternalReference(externalReference: string): Promise<AsaasCustomer | null> {
    const result = await this.http.request({
      method: "GET",
      path: "/customers",
      query: { externalReference, limit: 10, offset: 0 },
      schema: asaasCustomerListSchema,
    });

    const found = result.data
      .map(toCustomer)
      .find((customer) => customer.externalReference === externalReference);

    return found ?? null;
  }

  async createCustomer(input: AsaasCustomerInput): Promise<AsaasCustomer> {
    const payload: Record<string, unknown> = {
      name: input.legalName,
      cpfCnpj: input.document,
      email: input.email,
      phone: input.phone,
      mobilePhone: input.phone,
      externalReference: input.storeId,
    };

    if (input.postalCode && input.address && input.addressNumber) {
      payload.postalCode = input.postalCode;
      payload.address = input.address;
      payload.addressNumber = input.addressNumber;

      if (input.complement) {
        payload.complement = input.complement;
      }

      if (input.province) {
        payload.province = input.province;
      }
    }

    const result = await this.http.request({
      method: "POST",
      path: "/customers",
      body: payload,
      schema: asaasCustomerSchema,
    });

    return toCustomer(result);
  }

  /**
   * Idempotent by externalReference. Asaas accepts duplicate customers, so the
   * lookup first avoids creating a second identity for the same store.
   */
  async ensureCustomer(input: AsaasCustomerInput): Promise<AsaasCustomer> {
    const existing = await this.findCustomerByExternalReference(input.storeId);

    if (existing) {
      return existing;
    }

    return this.createCustomer(input);
  }

  async createSubscription(input: AsaasSubscriptionInput): Promise<AsaasSubscription> {
    const result = await this.http.request({
      method: "POST",
      path: "/subscriptions",
      body: {
        customer: input.customerId,
        billingType: "PIX",
        value: centsToAsaasValue(input.valueCents),
        nextDueDate: input.nextDueDate,
        cycle: "MONTHLY",
        description: input.description.slice(0, 500),
        externalReference: input.storeId,
      },
      schema: asaasSubscriptionSchema,
    });

    return toSubscription(result);
  }

  /**
   * Reuses an active Asaas subscription for the same store. If the previous
   * subscription is inactive/expired, a new one is created; the local binding
   * always points at the subscription that generated the visible charge.
   */
  async ensureActiveSubscription(input: AsaasSubscriptionInput): Promise<AsaasSubscription> {
    const existing = await this.findSubscriptionByExternalReference(input.storeId);

    if (existing && existing.status === "ACTIVE") {
      return existing;
    }

    return this.createSubscription(input);
  }

  async getSubscription(subscriptionId: string): Promise<AsaasSubscription> {
    const result = await this.http.request({
      method: "GET",
      path: `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      schema: asaasSubscriptionSchema,
    });

    return toSubscription(result);
  }

  /**
   * Recovery path for a retried request: Asaas may have created the
   * subscription even if the previous HTTP response was lost.
   */
  async findSubscriptionByExternalReference(
    externalReference: string,
  ): Promise<AsaasSubscription | null> {
    const result = await this.http.request({
      method: "GET",
      path: "/subscriptions",
      query: { externalReference, limit: 10, offset: 0 },
      schema: asaasSubscriptionListSchema,
    });

    const found = result.data
      .map(toSubscription)
      .find((subscription) => subscription.externalReference === externalReference);

    return found ?? null;
  }

  async listSubscriptionPayments(
    subscriptionId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<AsaasPayment[]> {
    const result = await this.http.request({
      method: "GET",
      path: `/subscriptions/${encodeURIComponent(subscriptionId)}/payments`,
      query: {
        limit: Math.min(100, Math.max(1, options.limit ?? 20)),
        offset: Math.max(0, options.offset ?? 0),
      },
      schema: asaasPaymentListSchema,
    });

    return result.data.map(toPayment);
  }

  async getPayment(paymentId: string): Promise<AsaasPayment> {
    const result = await this.http.request({
      method: "GET",
      path: `/payments/${encodeURIComponent(paymentId)}`,
      schema: asaasPaymentSchema,
    });

    return toPayment(result);
  }

  /**
   * Lists recent payments across the sandbox account. Used by reconciliation
   * to find confirmed payments whose webhook never arrived and external
   * charges that are not linked to any known local subscription.
   */
  async listRecentPayments(
    options: { limit?: number; offset?: number } = {},
  ): Promise<AsaasPayment[]> {
    const result = await this.http.request({
      method: "GET",
      path: "/payments",
      query: {
        limit: Math.min(100, Math.max(1, options.limit ?? 100)),
        offset: Math.max(0, options.offset ?? 0),
      },
      schema: asaasPaymentListSchema,
    });

    return result.data.map(toPayment);
  }

  async getPixQrCode(paymentId: string): Promise<AsaasPixQrCode | null> {
    try {
      const result = await this.http.request({
        method: "GET",
        path: `/payments/${encodeURIComponent(paymentId)}/pixQrCode`,
        schema: asaasPixQrCodeSchema,
      });

      return {
        encodedImage: result.encodedImage,
        payload: result.payload,
        expirationDate: result.expirationDate ?? null,
      };
    } catch (error) {
      // Pix QR is optional for the checkout to remain usable: the hosted
      // invoice URL is still shown. Auth and transport errors are not hidden.
      if (
        error instanceof AsaasError &&
        (error.code === "NOT_FOUND" || error.code === "VALIDATION")
      ) {
        return null;
      }

      throw error;
    }
  }

  /**
   * Charges are generated gradually by Asaas, so the first one may not exist
   * immediately after subscription creation. This polls a few times and
   * returns null instead of inventing a payment.
   */
  async waitForFirstPayment(
    subscriptionId: string,
    options: { attempts?: number; delayMs?: number } = {},
  ): Promise<AsaasPayment | null> {
    const attempts = Math.max(1, Math.min(10, options.attempts ?? 5));
    const delayMs = Math.max(0, Math.min(10_000, options.delayMs ?? 1_500));

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const payments = await this.listSubscriptionPayments(subscriptionId, { limit: 20 });
      const payable = payments
        .filter((payment) => !payment.deleted && payment.subscription === subscriptionId)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

      if (payable) {
        return payable;
      }

      if (attempt < attempts - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return null;
  }
}

export type CheckoutCharge = {
  subscription: AsaasSubscription;
  payment: AsaasPayment | null;
  pix: AsaasPixQrCode | null;
  paymentUrl: string | null;
};

export async function createSubscriptionAndFirstCharge(
  client: AsaasClientCore,
  input: AsaasSubscriptionInput,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<CheckoutCharge> {
  const subscription = await client.createSubscription(input);
  const payment = await client.waitForFirstPayment(subscription.id, {
    attempts: options.attempts,
    delayMs: options.delayMs,
  });

  if (!payment) {
    return { subscription, payment: null, pix: null, paymentUrl: null };
  }

  const pix = payment.billingType === "PIX" ? await client.getPixQrCode(payment.id) : null;
  const paymentUrl = safeInvoiceUrl(payment.invoiceUrl) ?? safeInvoiceUrl(payment.bankSlipUrl);

  return { subscription, payment, pix, paymentUrl };
}
