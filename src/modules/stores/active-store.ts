import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/modules/auth/session";
import {
  resolveActiveStore,
  type ActiveStoreResolution,
  type StoreMembershipSummary,
} from "@/modules/memberships/resolve-active-store";
import { listMembershipsForUser } from "@/modules/memberships/service";

export const ACTIVE_STORE_COOKIE = "avd_active_store";
export const ACTIVE_STORE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export type DashboardContext = {
  user: User;
  profileName: string;
  memberships: StoreMembershipSummary[];
  access: ActiveStoreResolution;
};

export const getDashboardContext = cache(async (): Promise<DashboardContext> => {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const [memberships, profileResult] = await Promise.all([
    listMembershipsForUser(supabase, user.id),
    supabase.from("profiles").select("name").eq("id", user.id).maybeSingle(),
  ]);

  const cookieStore = await cookies();
  const requestedStoreId = cookieStore.get(ACTIVE_STORE_COOKIE)?.value ?? null;

  return {
    user,
    profileName: profileResult.data?.name || user.email || "Usuário",
    memberships,
    access: resolveActiveStore(memberships, requestedStoreId),
  };
});

export async function getActiveMembership(): Promise<StoreMembershipSummary | null> {
  const context = await getDashboardContext();
  return context.access.status === "active" ? context.access.membership : null;
}
