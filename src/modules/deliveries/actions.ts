"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { ActionState } from "@/lib/action-state";
import { zodFieldErrors } from "@/lib/action-state";
import { isAppError, reportServerError } from "@/lib/errors";
import { createSupabaseAdminClient, findAuthUserByEmail } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSiteOrigin } from "@/modules/auth/site-url";
import { requireUser } from "@/modules/auth/session";
import { canManageDrivers, canAssignDeliveries, isDriver } from "@/modules/memberships/roles";
import { getMembershipForStore } from "@/modules/memberships/service";
import { ACTIVE_STORE_COOKIE, ACTIVE_STORE_COOKIE_MAX_AGE } from "@/modules/stores/active-store";
import { getActiveMembership } from "@/modules/stores/active-store";
import { getDriverDeliveriesForStore, listDriversForStore } from "@/modules/deliveries/service";
import type { DriverDelivery, DriverProfileSummary } from "@/modules/deliveries/types";

const uuidSchema = z.uuid("Identificador inválido.");

const driverInputSchema = z.object({
  email: z.email("Informe um e-mail válido."),
  name: z.string().trim().min(2, "Informe o nome do entregador.").max(120, "Nome muito longo."),
  phone: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ?? "").replace(/[^0-9]/g, ""))
    .refine((value) => value === "" || (value.length >= 10 && value.length <= 15), {
      message: "Use DDD + número, entre 10 e 15 dígitos.",
    }),
  mode: z.enum(["link", "invite"]),
});

const updateDriverSchema = z.object({
  driverProfileId: z.uuid("Entregador inválido."),
  displayName: z.string().trim().min(2, "Informe o nome.").max(120, "Nome muito longo."),
  phone: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ?? "").replace(/[^0-9]/g, ""))
    .refine((value) => value === "" || (value.length >= 10 && value.length <= 15), {
      message: "Use DDD + número, entre 10 e 15 dígitos.",
    }),
  active: z.boolean(),
});

export type CreateDriverInput = z.input<typeof driverInputSchema>;
export type UpdateDriverInput = z.input<typeof updateDriverSchema>;

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "";
}

function mapDriverError(error: unknown): string {
  const [code] = errorMessage(error).split("|");

  switch (code) {
    case "forbidden":
      return "Você não tem permissão para gerenciar entregadores desta loja.";
    case "user_role_conflict":
      return "Esta conta já possui outro papel nesta loja. Use uma conta exclusiva para entregas.";
    case "driver_exists":
      return "Esta conta já está cadastrada como entregadora desta loja.";
    case "driver_not_found":
      return "Entregador não encontrado.";
    case "driver_has_active_deliveries":
      return "Conclua ou reatribua as entregas ativas antes de desativar este entregador.";
    case "invalid_driver_name":
      return "Informe um nome válido para o entregador.";
    case "invalid_driver_phone":
      return "Informe um telefone válido com DDD.";
    case "invalid_reason":
      return "O motivo informado é muito longo.";
    default:
      return "Não foi possível concluir a ação. Tente novamente.";
  }
}

function mapDeliveryError(error: unknown): string {
  const [code] = errorMessage(error).split("|");

  switch (code) {
    case "forbidden":
      return "Você não tem permissão para esta ação de entrega.";
    case "order_not_found":
      return "Pedido não encontrado.";
    case "delivery_not_found":
      return "Entrega não encontrada.";
    case "pickup_not_assignable":
      return "Pedidos para retirada no local não recebem entregador.";
    case "order_not_assignable":
      return "Este pedido não está em um estado que permita atribuição.";
    case "driver_not_found":
      return "Entregador não encontrado.";
    case "driver_cross_store":
      return "O entregador não pertence a esta loja.";
    case "driver_inactive":
      return "Este entregador está inativo.";
    case "driver_not_member":
      return "A conta do entregador não possui mais vínculo ativo com a loja.";
    case "active_delivery_exists":
      return "O pedido já possui um entregador ativo. Use a reatribuição.";
    case "reassign_reason_required":
      return "Informe o motivo da reatribuição (mínimo de 3 caracteres).";
    case "delivery_not_active":
      return "Esta entrega já foi concluída ou cancelada.";
    case "delivery_already_picked_up":
      return "A coleta já foi registrada. Reatribua ou conclua a entrega.";
    case "delivery_completed":
      return "Esta entrega já foi concluída.";
    case "pickup_required":
      return "Registre a coleta antes de confirmar a entrega.";
    case "order_not_available":
      return "O pedido foi cancelado ou já foi concluído.";
    case "order_not_ready":
      return "O pedido ainda não está pronto para coleta.";
    case "order_not_out_for_delivery":
      return "O pedido não está em rota.";
    case "unauthorized":
      return "Sua sessão expirou. Entre novamente.";
    default:
      return "Não foi possível concluir a ação. Atualize a página e tente novamente.";
  }
}

export async function createDriverAction(input: CreateDriverInput): Promise<ActionState> {
  const parsed = driverInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      status: "error",
      message: "Revise os campos destacados.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  const membership = await getActiveMembership();

  if (!membership || !canManageDrivers(membership.role)) {
    return { status: "error", message: "Apenas proprietários e gerentes gerenciam entregadores." };
  }

  try {
    const existing = await findAuthUserByEmail(parsed.data.email);
    let userId = existing?.id;

    if (!userId && parsed.data.mode === "invite") {
      const admin = createSupabaseAdminClient();
      const origin = await getSiteOrigin();
      const { data, error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
        data: { name: parsed.data.name },
        redirectTo: `${origin}/auth/confirm?type=invite&next=/entregador`,
      });

      if (error || !data.user) {
        reportServerError("deliveries.inviteDriver", error);
        return {
          status: "error",
          message:
            "Não foi possível enviar o convite. O envio de e-mail pode não estar configurado neste ambiente; nenhum convite foi registrado.",
        };
      }

      userId = data.user.id;
    }

    if (!userId) {
      return {
        status: "error",
        message:
          "Não encontramos uma conta com este e-mail. Peça ao administrador da plataforma para criar o acesso ou use a opção de convite.",
      };
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("create_driver", {
      p_store_id: membership.storeId,
      p_user_id: userId,
      p_display_name: parsed.data.name,
      p_phone: parsed.data.phone || null,
    });

    if (error) {
      reportServerError("deliveries.createDriver", error);
      return { status: "error", message: mapDriverError(error) };
    }

    revalidatePath("/dashboard/entregadores");
    revalidatePath("/dashboard/pedidos");

    return {
      status: "success",
      message: existing
        ? "Entregador vinculado à loja."
        : "Convite registrado. O acesso será liberado quando a conta estiver ativa.",
    };
  } catch (error) {
    if (isAppError(error)) {
      return { status: "error", message: error.publicMessage };
    }

    reportServerError("deliveries.createDriver", error);
    return { status: "error", message: "Não foi possível cadastrar o entregador." };
  }
}

export async function updateDriverAction(input: UpdateDriverInput): Promise<ActionState> {
  const parsed = updateDriverSchema.safeParse(input);

  if (!parsed.success) {
    return {
      status: "error",
      message: "Revise os campos destacados.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  const membership = await getActiveMembership();

  if (!membership || !canManageDrivers(membership.role)) {
    return { status: "error", message: "Apenas proprietários e gerentes gerenciam entregadores." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("update_driver", {
    p_driver_profile_id: parsed.data.driverProfileId,
    p_display_name: parsed.data.displayName,
    p_phone: parsed.data.phone || null,
    p_active: parsed.data.active,
  });

  if (error) {
    reportServerError("deliveries.updateDriver", error);
    return { status: "error", message: mapDriverError(error) };
  }

  revalidatePath("/dashboard/entregadores");
  revalidatePath("/dashboard/pedidos");

  return { status: "success", message: "Entregador atualizado." };
}

export async function refreshDriversAction(): Promise<
  { ok: true; drivers: DriverProfileSummary[] } | { ok: false; message: string }
> {
  const membership = await getActiveMembership();

  if (!membership || !canManageDrivers(membership.role)) {
    return { ok: false, message: "Você não tem acesso aos entregadores desta loja." };
  }

  try {
    return { ok: true, drivers: await listDriversForStore(membership.storeId) };
  } catch (error) {
    reportServerError("deliveries.refreshDrivers", error);
    return { ok: false, message: "Não foi possível atualizar os entregadores." };
  }
}

export async function assignDeliveryAction(
  orderId: string,
  driverProfileId: string,
): Promise<ActionState> {
  const membership = await getActiveMembership();

  if (!membership || !canAssignDeliveries(membership.role)) {
    return { status: "error", message: "Apenas proprietários e gerentes atribuem entregas." };
  }

  if (!uuidSchema.safeParse(orderId).success || !uuidSchema.safeParse(driverProfileId).success) {
    return { status: "error", message: "Pedido ou entregador inválido." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("assign_delivery", {
    p_order_id: orderId,
    p_driver_profile_id: driverProfileId,
  });

  if (error) {
    reportServerError("deliveries.assign", error);
    return { status: "error", message: mapDeliveryError(error) };
  }

  revalidatePath("/dashboard/pedidos");
  revalidatePath("/entregador");

  return { status: "success", message: "Entregador atribuído ao pedido." };
}

export async function reassignDeliveryAction(
  deliveryId: string,
  driverProfileId: string,
  reason: string,
): Promise<ActionState> {
  const membership = await getActiveMembership();

  if (!membership || !canAssignDeliveries(membership.role)) {
    return { status: "error", message: "Apenas proprietários e gerentes reatribuem entregas." };
  }

  if (!uuidSchema.safeParse(deliveryId).success || !uuidSchema.safeParse(driverProfileId).success) {
    return { status: "error", message: "Entrega ou entregador inválido." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reassign_delivery", {
    p_delivery_id: deliveryId,
    p_new_driver_profile_id: driverProfileId,
    p_reason: reason.trim(),
  });

  if (error) {
    reportServerError("deliveries.reassign", error);
    return { status: "error", message: mapDeliveryError(error) };
  }

  revalidatePath("/dashboard/pedidos");
  revalidatePath("/entregador");

  return {
    status: "success",
    message: "Entrega reatribuída. O entregador anterior perdeu o acesso operacional.",
  };
}

export async function cancelDeliveryAction(
  deliveryId: string,
  reason: string,
): Promise<ActionState> {
  const membership = await getActiveMembership();

  if (!membership || !canAssignDeliveries(membership.role)) {
    return { status: "error", message: "Apenas proprietários e gerentes cancelam atribuições." };
  }

  if (!uuidSchema.safeParse(deliveryId).success) {
    return { status: "error", message: "Entrega inválida." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("cancel_delivery", {
    p_delivery_id: deliveryId,
    p_reason: reason.trim() || null,
  });

  if (error) {
    reportServerError("deliveries.cancel", error);
    return { status: "error", message: mapDeliveryError(error) };
  }

  revalidatePath("/dashboard/pedidos");
  revalidatePath("/entregador");

  return { status: "success", message: "Atribuição cancelada." };
}

export async function startDeliveryAction(deliveryId: string): Promise<ActionState> {
  if (!uuidSchema.safeParse(deliveryId).success) {
    return { status: "error", message: "Entrega inválida." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("start_delivery", { p_delivery_id: deliveryId });

  if (error) {
    reportServerError("deliveries.start", error);
    return { status: "error", message: mapDeliveryError(error) };
  }

  revalidatePath("/entregador");
  revalidatePath("/dashboard/pedidos");

  return { status: "success", message: "Coleta registrada. Pedido em rota." };
}

export async function completeDeliveryAction(deliveryId: string): Promise<ActionState> {
  if (!uuidSchema.safeParse(deliveryId).success) {
    return { status: "error", message: "Entrega inválida." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("complete_delivery", { p_delivery_id: deliveryId });

  if (error) {
    reportServerError("deliveries.complete", error);
    return { status: "error", message: mapDeliveryError(error) };
  }

  revalidatePath("/entregador");
  revalidatePath("/dashboard/pedidos");

  return { status: "success", message: "Entrega confirmada. Pedido concluído." };
}

export async function refreshDriverDeliveriesAction(
  storeId: string,
): Promise<{ ok: true; deliveries: DriverDelivery[] } | { ok: false; message: string }> {
  const user = await requireUser();

  if (!uuidSchema.safeParse(storeId).success) {
    return { ok: false, message: "Loja inválida." };
  }

  const supabase = await createSupabaseServerClient();
  const membership = await getMembershipForStore(supabase, user.id, storeId);

  if (!membership || !isDriver(membership.role)) {
    return { ok: false, message: "Você não é entregador desta loja." };
  }

  try {
    return {
      ok: true,
      deliveries: await getDriverDeliveriesForStore(user.id, storeId),
    };
  } catch (error) {
    reportServerError("deliveries.refreshDriver", error);
    return { ok: false, message: "Não foi possível atualizar suas entregas." };
  }
}

export async function selectDriverStoreAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const storeId = String(formData.get("storeId") ?? "");

  if (!uuidSchema.safeParse(storeId).success) {
    redirect("/entregador");
  }

  const supabase = await createSupabaseServerClient();
  const membership = await getMembershipForStore(supabase, user.id, storeId);

  if (!membership || !isDriver(membership.role)) {
    redirect("/entregador");
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_STORE_COOKIE, storeId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACTIVE_STORE_COOKIE_MAX_AGE,
  });

  redirect("/entregador");
}
