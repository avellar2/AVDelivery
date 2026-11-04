"use server";

import { revalidatePath } from "next/cache";

import { type ActionState, zodFieldErrors } from "@/lib/action-state";
import { isAppError, reportServerError } from "@/lib/errors";
import { findAuthUserByEmail } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/modules/auth/session";
import { isPlatformAdmin } from "@/modules/platform-admin/guard";
import {
  addStoreOwnerSchema,
  createStoreSchema,
  subscriptionActionSchema,
  updateStoreSchema,
} from "@/modules/subscriptions/validation";

export type AdminBillingActionState = ActionState & {
  storeId?: string;
  slug?: string;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function mapBillingError(error: unknown): string {
  const [code] = errorText(error).split("|");

  switch (code) {
    case "forbidden":
      return "Apenas superadministradores podem executar esta operação.";
    case "unauthorized":
      return "Sua sessão expirou. Entre novamente.";
    case "slug_taken":
      return "Já existe um estabelecimento com este identificador público.";
    case "invalid_store_name":
      return "Informe um nome de estabelecimento válido.";
    case "invalid_store_slug":
      return "Use um identificador com letras minúsculas, números e hífens (3 a 80 caracteres).";
    case "invalid_store_description":
      return "A descrição deve ter no máximo 500 caracteres.";
    case "invalid_store_phone":
      return "Informe um telefone válido.";
    case "invalid_plan":
      return "O plano selecionado não está disponível.";
    case "owner_not_found":
      return "Não encontramos uma conta com este e-mail. Crie o acesso do proprietário antes de vincular.";
    case "store_not_found":
      return "Estabelecimento não encontrado.";
    case "subscription_missing":
      return "Este estabelecimento não possui assinatura. Regularize o cadastro comercial.";
    case "invalid_reason":
      return "Informe um motivo com pelo menos 3 caracteres.";
    case "invalid_days":
      return "Informe um número de dias válido.";
    case "invalid_action":
      return "Ação de assinatura inválida.";
    case "idempotency_conflict":
      return "Esta requisição já foi usada com outro conteúdo. Recarregue a página.";
    case "default_plan_missing":
      return "O plano padrão da plataforma não está configurado.";
    default:
      return "Não foi possível concluir a operação. Tente novamente.";
  }
}

async function requireAdminAction(): Promise<{ userId: string } | null> {
  const user = await requireUser();
  const admin = await isPlatformAdmin(user.id);
  return admin ? { userId: user.id } : null;
}

export async function createStoreAction(
  _previousState: AdminBillingActionState,
  formData: FormData,
): Promise<AdminBillingActionState> {
  const admin = await requireAdminAction();

  if (!admin) {
    return {
      status: "error",
      message: "Apenas superadministradores podem criar estabelecimentos.",
    };
  }

  const parsed = createStoreSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    ownerEmail: String(formData.get("ownerEmail") ?? ""),
    planId: String(formData.get("planId") ?? ""),
    startTrial: formData.get("startTrial") === "on",
    requestId: String(formData.get("requestId") ?? ""),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Revise os campos destacados.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  try {
    const owner = await findAuthUserByEmail(parsed.data.ownerEmail);

    if (!owner) {
      return {
        status: "error",
        message:
          "Não encontramos uma conta com este e-mail. O cadastro público está desabilitado; crie o acesso do proprietário antes de vincular.",
        fieldErrors: {
          ownerEmail: ["Nenhuma conta encontrada para este e-mail."],
        },
      };
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("admin_create_store", {
      p_name: parsed.data.name,
      p_slug: parsed.data.slug,
      p_description: parsed.data.description,
      p_phone: parsed.data.phone,
      p_plan_id: parsed.data.planId,
      p_owner_user_id: owner.id,
      p_start_trial: parsed.data.startTrial,
      p_request_id: parsed.data.requestId,
    });

    if (error) {
      reportServerError("subscriptions.createStore", error);
      return { status: "error", message: mapBillingError(error) };
    }

    const result = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    const storeId = typeof result.storeId === "string" ? result.storeId : undefined;
    const slug = typeof result.slug === "string" ? result.slug : undefined;

    revalidatePath("/admin");
    revalidatePath("/admin/lojas/nova");

    return {
      status: "success",
      message: "Estabelecimento criado com assinatura e proprietário vinculados.",
      storeId,
      slug,
    };
  } catch (error) {
    if (isAppError(error)) {
      return { status: "error", message: error.publicMessage };
    }

    reportServerError("subscriptions.createStore", error);
    return { status: "error", message: mapBillingError(error) };
  }
}

export async function updateStoreAction(
  _previousState: AdminBillingActionState,
  formData: FormData,
): Promise<AdminBillingActionState> {
  const admin = await requireAdminAction();

  if (!admin) {
    return {
      status: "error",
      message: "Apenas superadministradores podem editar estabelecimentos.",
    };
  }

  const parsed = updateStoreSchema.safeParse({
    storeId: String(formData.get("storeId") ?? ""),
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    active: formData.get("active") === "on",
    reason: String(formData.get("reason") ?? ""),
    requestId: String(formData.get("requestId") ?? ""),
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
    const { error } = await supabase.rpc("admin_update_store", {
      p_store_id: parsed.data.storeId,
      p_name: parsed.data.name,
      p_description: parsed.data.description,
      p_phone: parsed.data.phone,
      p_active: parsed.data.active,
      p_reason: parsed.data.reason,
      p_request_id: parsed.data.requestId,
    });

    if (error) {
      reportServerError("subscriptions.updateStore", error);
      return { status: "error", message: mapBillingError(error) };
    }

    revalidatePath("/admin");
    revalidatePath(`/admin/lojas/${parsed.data.storeId}`);

    return { status: "success", message: "Dados administrativos atualizados." };
  } catch (error) {
    reportServerError("subscriptions.updateStore", error);
    return { status: "error", message: mapBillingError(error) };
  }
}

export async function updateSubscriptionAction(
  _previousState: AdminBillingActionState,
  formData: FormData,
): Promise<AdminBillingActionState> {
  const admin = await requireAdminAction();

  if (!admin) {
    return { status: "error", message: "Apenas superadministradores podem alterar assinaturas." };
  }

  const parsed = subscriptionActionSchema.safeParse({
    storeId: String(formData.get("storeId") ?? ""),
    action: String(formData.get("action") ?? ""),
    days: String(formData.get("days") ?? ""),
    planId: String(formData.get("planId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    requestId: String(formData.get("requestId") ?? ""),
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
    const { error } = await supabase.rpc("admin_update_subscription", {
      p_store_id: parsed.data.storeId,
      p_action: parsed.data.action,
      p_days: parsed.data.days,
      p_plan_id: parsed.data.planId,
      p_reason: parsed.data.reason,
      p_request_id: parsed.data.requestId,
    });

    if (error) {
      reportServerError("subscriptions.updateSubscription", error);
      return { status: "error", message: mapBillingError(error) };
    }

    revalidatePath("/admin");
    revalidatePath(`/admin/lojas/${parsed.data.storeId}`);
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/assinatura");
    revalidatePath("/loja", "layout");

    return { status: "success", message: "Assinatura atualizada e evento registrado." };
  } catch (error) {
    reportServerError("subscriptions.updateSubscription", error);
    return { status: "error", message: mapBillingError(error) };
  }
}

export async function addStoreOwnerAction(
  _previousState: AdminBillingActionState,
  formData: FormData,
): Promise<AdminBillingActionState> {
  const admin = await requireAdminAction();

  if (!admin) {
    return {
      status: "error",
      message: "Apenas superadministradores podem vincular proprietários.",
    };
  }

  const parsed = addStoreOwnerSchema.safeParse({
    storeId: String(formData.get("storeId") ?? ""),
    ownerEmail: String(formData.get("ownerEmail") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    requestId: String(formData.get("requestId") ?? ""),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Revise os campos destacados.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  try {
    const owner = await findAuthUserByEmail(parsed.data.ownerEmail);

    if (!owner) {
      return {
        status: "error",
        message: "Não encontramos uma conta com este e-mail.",
        fieldErrors: { ownerEmail: ["Nenhuma conta encontrada para este e-mail."] },
      };
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("admin_add_store_owner", {
      p_store_id: parsed.data.storeId,
      p_user_id: owner.id,
      p_reason: parsed.data.reason,
      p_request_id: parsed.data.requestId,
    });

    if (error) {
      reportServerError("subscriptions.addOwner", error);
      return { status: "error", message: mapBillingError(error) };
    }

    revalidatePath("/admin");
    revalidatePath(`/admin/lojas/${parsed.data.storeId}`);

    return { status: "success", message: "Proprietário vinculado à loja." };
  } catch (error) {
    if (isAppError(error)) {
      return { status: "error", message: error.publicMessage };
    }

    reportServerError("subscriptions.addOwner", error);
    return { status: "error", message: mapBillingError(error) };
  }
}
