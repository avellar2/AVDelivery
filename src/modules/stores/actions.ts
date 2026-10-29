"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { zodFieldErrors, type ActionState } from "@/lib/action-state";
import { reportServerError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/modules/auth/session";
import { canManageSettings, canToggleStoreActive } from "@/modules/memberships/roles";
import { getMembershipForStore } from "@/modules/memberships/service";
import { ACTIVE_STORE_COOKIE, ACTIVE_STORE_COOKIE_MAX_AGE } from "@/modules/stores/active-store";
import { storeSettingsSchema } from "@/modules/stores/validation";
import type { Database } from "@/types/database";

export async function selectStoreAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const storeId = String(formData.get("storeId") ?? "");

  if (!z.uuid().safeParse(storeId).success) {
    redirect("/dashboard");
  }

  const supabase = await createSupabaseServerClient();
  const membership = await getMembershipForStore(supabase, user.id, storeId);

  if (!membership) {
    redirect("/dashboard");
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_STORE_COOKIE, storeId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACTIVE_STORE_COOKIE_MAX_AGE,
  });

  redirect("/dashboard");
}

export async function updateStoreSettingsAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const storeId = String(formData.get("storeId") ?? "");

  if (!z.uuid().safeParse(storeId).success) {
    return { status: "error", message: "Loja inválida." };
  }

  const supabase = await createSupabaseServerClient();
  const membership = await getMembershipForStore(supabase, user.id, storeId);

  if (!membership || !canManageSettings(membership.role)) {
    return {
      status: "error",
      message: "Você não tem permissão para alterar as configurações desta loja.",
    };
  }

  const parsed = storeSettingsSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    logoUrl: String(formData.get("logoUrl") ?? ""),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Revise os campos destacados.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  const updates: Database["public"]["Tables"]["stores"]["Update"] = {
    name: parsed.data.name,
    description: parsed.data.description,
    phone: parsed.data.phone,
    logo_url: parsed.data.logoUrl,
  };

  if (canToggleStoreActive(membership.role)) {
    updates.active = formData.get("active") === "on";
  }

  const { data, error } = await supabase
    .from("stores")
    .update(updates)
    .eq("id", storeId)
    .select("id")
    .maybeSingle();

  if (error) {
    reportServerError("stores.updateSettings", error);
    return {
      status: "error",
      message: "Não foi possível salvar as configurações. Tente novamente.",
    };
  }

  if (!data) {
    return {
      status: "error",
      message: "Você não tem permissão para alterar as configurações desta loja.",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/configuracoes");

  return { status: "success", message: "Configurações salvas com sucesso." };
}
