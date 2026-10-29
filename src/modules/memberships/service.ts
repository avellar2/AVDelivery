import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DatabaseError } from "@/lib/errors";
import type { StoreMemberRole } from "@/types/database";
import type { Database } from "@/types/database";
import type { StoreMembershipSummary } from "@/modules/memberships/resolve-active-store";

export type MembershipRecord = {
  id: string;
  storeId: string;
  role: StoreMemberRole;
};

export async function listMembershipsForUser(
  client: SupabaseClient<Database>,
  userId: string,
): Promise<StoreMembershipSummary[]> {
  const { data: memberships, error } = await client
    .from("store_memberships")
    .select("id, store_id, role, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new DatabaseError("memberships.listForUser", error);
  }

  if (!memberships || memberships.length === 0) {
    return [];
  }

  const storeIds = memberships.map((membership) => membership.store_id);
  const { data: stores, error: storesError } = await client
    .from("stores")
    .select("id, name, slug, active")
    .in("id", storeIds);

  if (storesError) {
    throw new DatabaseError("memberships.listStores", storesError);
  }

  const storesById = new Map((stores ?? []).map((store) => [store.id, store]));

  return memberships
    .flatMap((membership) => {
      const store = storesById.get(membership.store_id);

      if (!store) {
        return [];
      }

      return [
        {
          membershipId: membership.id,
          storeId: store.id,
          storeName: store.name,
          storeSlug: store.slug,
          storeActive: store.active,
          role: membership.role,
        },
      ];
    })
    .sort((a, b) => a.storeName.localeCompare(b.storeName, "pt-BR"));
}

export async function getMembershipForStore(
  client: SupabaseClient<Database>,
  userId: string,
  storeId: string,
): Promise<MembershipRecord | null> {
  const { data, error } = await client
    .from("store_memberships")
    .select("id, store_id, role")
    .eq("user_id", userId)
    .eq("store_id", storeId)
    .maybeSingle();

  if (error) {
    throw new DatabaseError("memberships.getForStore", error);
  }

  if (!data) {
    return null;
  }

  return { id: data.id, storeId: data.store_id, role: data.role };
}
