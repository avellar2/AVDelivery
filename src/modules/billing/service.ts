import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { reportServerError } from "@/lib/errors";
import {
  AsaasConfigurationError,
  createAsaasClient,
  getAsaasConfigurationStatus,
  isAsaasError,
} from "@/modules/billing/providers/asaas/client";
import { createSubscriptionAndFirstCharge } from "@/modules/billing/providers/asaas/client-core";
import { asaasValueToCents, safeInvoiceUrl } from "@/modules/billing/providers/asaas/money";
import type { AsaasPayment, AsaasPixQrCode } from "@/modules/billing/providers/asaas/types";
import {
  BillingProcessingError,
  syncSubscriptionFromProvider,
} from "@/modules/billing/reconcile-core";
import type {
  BillingConnection,
  BillingProfile,
  OwnerBillingSubscription,
  OwnerCheckoutSummary,
} from "@/modules/billing/types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function getBillingConnection(): BillingConnection {
  const status = getAsaasConfigurationStatus();
  return {
    provider: "asaas",
    environment: "sandbox",
    configured: status.configured,
    missing: status.missing,
  };
}

export async function getOwnerBillingProfile(storeId: string): Promise<BillingProfile | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("owner_get_billing_profile", {
    p_store_id: storeId,
  });

  if (error) {
    throw new BillingProcessingError(error.message.split("|")[0]);
  }

  const record = asRecord(data);

  if (!record) {
    return null;
  }

  return {
    storeId: String(record.storeId ?? storeId),
    legalName: String(record.legalName ?? ""),
    document: String(record.document ?? ""),
    email: String(record.email ?? ""),
    phone: String(record.phone ?? ""),
    postalCode: asString(record.postalCode),
    address: asString(record.address),
    addressNumber: asString(record.addressNumber),
    complement: asString(record.complement),
    province: asString(record.province),
    externalCustomerId: asString(record.externalCustomerId),
    updatedAt: asString(record.updatedAt),
  };
}

export async function getOwnerBillingSubscription(
  storeId: string,
): Promise<OwnerBillingSubscription | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select("external_provider, external_subscription_id, external_status, last_synced_at")
    .eq("store_id", storeId)
    .maybeSingle();

  if (error) {
    throw new BillingProcessingError(error.message.split("|")[0]);
  }

  if (!data) {
    return null;
  }

  return {
    externalProvider: data.external_provider,
    externalSubscriptionId: data.external_subscription_id,
    externalStatus: data.external_status,
    lastSyncedAt: data.last_synced_at,
  };
}

export async function getOwnerCheckout(storeId: string): Promise<OwnerCheckoutSummary | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("billing_checkout_requests")
    .select(
      "status, external_subscription_id, first_payment_id, payment_url, pix_payload, error_message, created_at, expires_at",
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new BillingProcessingError(error.message.split("|")[0]);
  }

  if (!data) {
    return null;
  }

  return {
    status: data.status,
    externalSubscriptionId: data.external_subscription_id,
    firstPaymentId: data.first_payment_id,
    paymentUrl: safeInvoiceUrl(data.payment_url),
    pixPayload: data.pix_payload,
    errorMessage: data.error_message,
    createdAt: data.created_at,
    expiresAt: data.expires_at,
  };
}

function mapCheckoutError(error: unknown): string {
  if (error instanceof AsaasConfigurationError) {
    return "A integração com o Asaas Sandbox ainda não está configurada no servidor.";
  }

  if (error instanceof BillingProcessingError) {
    switch (error.reason) {
      case "billing_profile_missing":
      case "billing_customer_missing":
        return "Salve os dados de faturamento antes de gerar a cobrança.";
      case "subscription_exempt":
        return "Esta loja possui isenção administrativa e não precisa gerar cobrança.";
      case "checkout_in_progress":
        return "Já existe uma cobrança sendo criada para esta loja. Aguarde alguns instantes e verifique novamente.";
      case "external_customer_conflict":
      case "external_subscription_conflict":
        return "Os identificadores externos desta loja divergem do Asaas. Acione o suporte antes de gerar outra cobrança.";
      case "amount_mismatch":
      case "currency_mismatch":
        return "O valor ou a moeda retornados pelo Asaas divergem do plano. A cobrança não foi aplicada.";
      default:
        return "Não foi possível concluir a cobrança no Asaas. Tente novamente.";
    }
  }

  if (isAsaasError(error)) {
    switch (error.code) {
      case "AUTH":
        return "O Asaas Sandbox recusou a credencial configurada no servidor.";
      case "RATE_LIMIT":
        return "O Asaas está limitando requisições. Aguarde alguns minutos e tente novamente.";
      case "TIMEOUT":
        return "O Asaas Sandbox demorou para responder. Tente novamente.";
      case "NETWORK":
        return "Não foi possível falar com o Asaas Sandbox. Verifique a conexão do servidor.";
      case "VALIDATION":
        return error.message;
      default:
        return "O Asaas não concluiu a operação. Tente novamente mais tarde.";
    }
  }

  return "Não foi possível concluir a cobrança. Tente novamente.";
}

function chooseFirstPayment(payments: AsaasPayment[], subscriptionId: string) {
  return payments
    .filter((payment) => !payment.deleted && payment.subscription === subscriptionId)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
}

export type CheckoutResult = {
  status: "success" | "error";
  message: string;
  paymentUrl: string | null;
  pixPayload: string | null;
  reused: boolean;
};

/**
 * Creates (or safely resumes) an Asaas Sandbox subscription for one store.
 * The local commercial state is never activated here: only a later verified
 * payment can release the store.
 */
export async function startOwnerCheckout(
  storeId: string,
  requestId: string,
): Promise<CheckoutResult> {
  const admin = createSupabaseAdminClient();
  let attempted = false;

  try {
    const profile = await getOwnerBillingProfile(storeId);

    if (!profile) {
      return {
        status: "error",
        message: "Salve os dados de faturamento antes de gerar a cobrança.",
        paymentUrl: null,
        pixPayload: null,
        reused: false,
      };
    }

    const client = createAsaasClient();
    const customer = await client.ensureCustomer({
      storeId,
      legalName: profile.legalName,
      document: profile.document,
      email: profile.email,
      phone: profile.phone,
      postalCode: profile.postalCode,
      address: profile.address,
      addressNumber: profile.addressNumber,
      complement: profile.complement,
      province: profile.province,
    });

    const bound = await admin.rpc("billing_bind_customer", {
      p_store_id: storeId,
      p_provider: "asaas",
      p_external_customer_id: customer.id,
    });

    if (bound.error) {
      throw new BillingProcessingError(bound.error.message.split("|")[0]);
    }

    attempted = true;

    const { data, error } = await admin.rpc("billing_begin_checkout", {
      p_store_id: storeId,
      p_request_id: requestId,
    });

    if (error) {
      throw new BillingProcessingError(error.message.split("|")[0]);
    }

    const checkout = asRecord(data) ?? {};
    const reused = checkout.reused === true;
    const priceCents = asNumber(checkout.priceCents);
    const planName = String(checkout.planName ?? "AVDelivery");
    let externalSubscriptionId = asString(checkout.externalSubscriptionId);
    let externalStatus = "ACTIVE";
    let payment: AsaasPayment | null = null;
    let pix: AsaasPixQrCode | null = null;

    if (externalSubscriptionId) {
      const payments = await client.listSubscriptionPayments(externalSubscriptionId, { limit: 20 });
      payment = chooseFirstPayment(payments, externalSubscriptionId) ?? null;
      pix = payment ? await client.getPixQrCode(payment.id) : null;
    } else {
      const existing = await client.findSubscriptionByExternalReference(storeId);

      if (existing && existing.status === "ACTIVE") {
        externalSubscriptionId = existing.id;
        externalStatus = existing.status;
        const payments = await client.listSubscriptionPayments(existing.id, { limit: 20 });
        payment = chooseFirstPayment(payments, existing.id) ?? null;
        pix = payment ? await client.getPixQrCode(payment.id) : null;
      } else {
        const nextDueDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Sao_Paulo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());
        const charge = await createSubscriptionAndFirstCharge(
          client,
          {
            customerId: customer.id,
            storeId,
            valueCents: priceCents,
            nextDueDate,
            description: `AVDelivery - ${planName}`,
          },
          { attempts: 4, delayMs: 1_200 },
        );

        externalSubscriptionId = charge.subscription.id;
        externalStatus = charge.subscription.status;
        payment = charge.payment;
        pix = charge.pix;
      }
    }

    const paymentUrl = safeInvoiceUrl(payment?.invoiceUrl) ?? safeInvoiceUrl(payment?.bankSlipUrl);

    const completed = await admin.rpc("billing_complete_checkout", {
      p_store_id: storeId,
      p_request_id: requestId,
      p_external_subscription_id: externalSubscriptionId,
      p_external_status: externalStatus,
      p_payment_id: payment?.id ?? null,
      p_payment_url: paymentUrl,
      p_pix_payload: pix?.payload ?? null,
      p_amount_cents: payment ? asaasValueToCents(payment.value) : null,
      p_due_date: payment?.dueDate ?? null,
      p_billing_type: payment?.billingType ?? null,
    });

    if (completed.error) {
      throw new BillingProcessingError(completed.error.message.split("|")[0]);
    }

    if (!payment) {
      return {
        status: "success",
        message:
          "Assinatura criada no Asaas Sandbox. O provedor ainda está gerando a primeira cobrança; use “Verificar pagamento” em alguns instantes.",
        paymentUrl: null,
        pixPayload: null,
        reused,
      };
    }

    return {
      status: "success",
      message:
        "Cobrança Pix criada no Asaas Sandbox. A loja só será liberada depois que o Asaas confirmar o pagamento — criar a assinatura não significa pagamento recebido.",
      paymentUrl,
      pixPayload: pix?.payload ?? null,
      reused,
    };
  } catch (error) {
    reportServerError("billing.startCheckout", error);

    if (attempted) {
      await admin.rpc("billing_fail_checkout", {
        p_store_id: storeId,
        p_request_id: requestId,
        p_error: mapCheckoutError(error).slice(0, 1000),
      });
    }

    return {
      status: "error",
      message: mapCheckoutError(error),
      paymentUrl: null,
      pixPayload: null,
      reused: false,
    };
  }
}

export type RefreshResult = {
  status: "success" | "error" | "not_created";
  message: string;
  applied: number;
  ignored: number;
  failures: number;
};

/**
 * Manual consistency check for the owner. It queries Asaas, reuses the same
 * idempotent RPC as webhooks and never grants access without a confirmed
 * payment. It is not presented as a replacement for webhooks.
 */
export async function refreshOwnerSubscription(storeId: string): Promise<RefreshResult> {
  const admin = createSupabaseAdminClient();

  try {
    const subscription = await getOwnerBillingSubscription(storeId);

    if (!subscription?.externalSubscriptionId) {
      return {
        status: "not_created",
        message: "Ainda não existe assinatura externa no Asaas para esta loja.",
        applied: 0,
        ignored: 0,
        failures: 0,
      };
    }

    const client = createAsaasClient();
    const external = await client.getSubscription(subscription.externalSubscriptionId);
    const sync = await syncSubscriptionFromProvider(admin, client, external, {
      eventType: "OWNER_REFRESH",
    });

    return {
      status: "success",
      message:
        sync.applied > 0
          ? "Consulta concluída. Estados de cobrança atualizados a partir do Asaas."
          : "Consulta concluída. Nenhuma mudança de pagamento foi encontrada.",
      applied: sync.applied,
      ignored: sync.ignored,
      failures: sync.failures.length,
    };
  } catch (error) {
    reportServerError("billing.refresh", error);

    return {
      status: "error",
      message: mapCheckoutError(error),
      applied: 0,
      ignored: 0,
      failures: 0,
    };
  }
}

export type BillingOverview = {
  profile: BillingProfile | null;
  external: OwnerBillingSubscription | null;
  checkout: OwnerCheckoutSummary | null;
  connection: BillingConnection;
};

export async function getOwnerBillingOverview(storeId: string): Promise<BillingOverview> {
  const [profile, external, checkout] = await Promise.all([
    getOwnerBillingProfile(storeId),
    getOwnerBillingSubscription(storeId),
    getOwnerCheckout(storeId),
  ]);

  return { profile, external, checkout, connection: getBillingConnection() };
}
