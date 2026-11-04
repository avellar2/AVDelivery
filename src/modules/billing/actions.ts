"use server";

import { revalidatePath } from "next/cache";

import { type ActionState, zodFieldErrors } from "@/lib/action-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { refreshOwnerSubscription, startOwnerCheckout } from "@/modules/billing/service";
import {
  billingProfileSchema,
  checkoutRequestSchema,
  refreshChargeSchema,
} from "@/modules/billing/validation";
import { getDashboardContext } from "@/modules/stores/active-store";

export type BillingActionState = ActionState & {
  paymentUrl?: string | null;
  pixPayload?: string | null;
  applied?: number;
};

async function requireOwnerStore(): Promise<
  { ok: true; storeId: string } | { ok: false; message: string }
> {
  const context = await getDashboardContext();

  if (context.access.status !== "active") {
    return { ok: false, message: "Selecione uma loja ativa para continuar." };
  }

  if (context.access.membership.role !== "owner") {
    return {
      ok: false,
      message: "Apenas o proprietário pode administrar a assinatura.",
    };
  }

  return { ok: true, storeId: context.access.membership.storeId };
}

function mapProfileError(error: unknown): string {
  const code = error instanceof Error ? error.message.split("|")[0].trim() : "unknown";

  switch (code) {
    case "unauthorized":
      return "Sua sessão expirou. Entre novamente.";
    case "forbidden":
      return "Apenas o proprietário pode alterar os dados de faturamento.";
    case "subscription_missing":
      return "Esta loja não possui assinatura registrada.";
    case "invalid_legal_name":
      return "Informe a razão social ou nome completo.";
    case "invalid_document":
      return "Informe um CPF ou CNPJ válido.";
    case "invalid_email":
      return "Informe um e-mail financeiro válido.";
    case "invalid_phone":
      return "Informe um telefone com DDD.";
    case "invalid_postal_code":
      return "Informe um CEP válido ou deixe em branco.";
    case "invalid_address":
      return "O endereço informado é inválido.";
    case "invalid_address_number":
      return "O número do endereço é inválido.";
    case "invalid_complement":
      return "O complemento informado é inválido.";
    case "invalid_province":
      return "O bairro informado é inválido.";
    default:
      return "Não foi possível salvar os dados de faturamento. Tente novamente.";
  }
}

export async function saveBillingProfileAction(
  _previousState: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const owner = await requireOwnerStore();

  if (!owner.ok) {
    return { status: "error", message: owner.message };
  }

  const parsed = billingProfileSchema.safeParse({
    legalName: String(formData.get("legalName") ?? ""),
    document: String(formData.get("document") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    postalCode: String(formData.get("postalCode") ?? ""),
    address: String(formData.get("address") ?? ""),
    addressNumber: String(formData.get("addressNumber") ?? ""),
    complement: String(formData.get("complement") ?? ""),
    province: String(formData.get("province") ?? ""),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Revise os campos destacados.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("owner_upsert_billing_profile", {
      p_store_id: owner.storeId,
      p_legal_name: parsed.data.legalName,
      p_document: parsed.data.document,
      p_email: parsed.data.email,
      p_phone: parsed.data.phone,
      p_postal_code: parsed.data.postalCode,
      p_address: parsed.data.address,
      p_address_number: parsed.data.addressNumber,
      p_complement: parsed.data.complement,
      p_province: parsed.data.province,
    });

    if (error) {
      return { status: "error", message: mapProfileError(error) };
    }

    revalidatePath("/dashboard/assinatura");
    return {
      status: "success",
      message:
        "Dados de faturamento salvos. O CPF/CNPJ completo fica visível apenas para você e para a administração da plataforma.",
    };
  } catch (error) {
    return { status: "error", message: mapProfileError(error) };
  }
}

export async function generateChargeAction(
  _previousState: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const owner = await requireOwnerStore();

  if (!owner.ok) {
    return { status: "error", message: owner.message };
  }

  const parsed = checkoutRequestSchema.safeParse({
    requestId: String(formData.get("requestId") ?? ""),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Requisição inválida. Recarregue a página.",
    };
  }

  const result = await startOwnerCheckout(owner.storeId, parsed.data.requestId);

  revalidatePath("/dashboard/assinatura");
  revalidatePath("/dashboard");
  revalidatePath("/admin");

  return {
    status: result.status,
    message: result.message,
    paymentUrl: result.paymentUrl,
    pixPayload: result.pixPayload,
  };
}

export async function refreshChargeAction(
  _previousState: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const owner = await requireOwnerStore();

  if (!owner.ok) {
    return { status: "error", message: owner.message };
  }

  const parsed = refreshChargeSchema.safeParse({
    requestId: String(formData.get("requestId") ?? ""),
  });

  if (!parsed.success) {
    return { status: "error", message: "Requisição inválida. Recarregue a página." };
  }

  const result = await refreshOwnerSubscription(owner.storeId);

  revalidatePath("/dashboard/assinatura");
  revalidatePath("/dashboard");

  return {
    status:
      result.status === "success" ? "success" : result.status === "not_created" ? "idle" : "error",
    message: result.message,
    applied: result.applied,
  };
}
