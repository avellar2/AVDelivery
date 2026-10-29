import "server-only";

import { DatabaseError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PlatformStoreSummary = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  createdAt: string;
  memberCount: number;
  ownerCount: number;
};

export async function listPlatformStores(): Promise<PlatformStoreSummary[]> {
  const supabase = await createSupabaseServerClient();
  const { data: stores, error } = await supabase
    .from("stores")
    .select("id, name, slug, active, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new DatabaseError("platformAdmin.listStores", error);
  }

  if (!stores || stores.length === 0) {
    return [];
  }

  const storeIds = stores.map((store) => store.id);
  const { data: memberships, error: membershipsError } = await supabase
    .from("store_memberships")
    .select("store_id, role")
    .in("store_id", storeIds);

  if (membershipsError) {
    throw new DatabaseError("platformAdmin.listMemberships", membershipsError);
  }

  const counts = new Map<string, { memberCount: number; ownerCount: number }>();

  for (const membership of memberships ?? []) {
    const current = counts.get(membership.store_id) ?? { memberCount: 0, ownerCount: 0 };
    current.memberCount += 1;
    if (membership.role === "owner") {
      current.ownerCount += 1;
    }
    counts.set(membership.store_id, current);
  }

  return stores.map((store) => {
    const count = counts.get(store.id) ?? { memberCount: 0, ownerCount: 0 };

    return {
      id: store.id,
      name: store.name,
      slug: store.slug,
      active: store.active,
      createdAt: store.created_at,
      memberCount: count.memberCount,
      ownerCount: count.ownerCount,
    };
  });
}
