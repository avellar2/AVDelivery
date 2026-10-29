import "server-only";

import { ForbiddenError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/modules/auth/session";
import { getMembershipForStore, type MembershipRecord } from "@/modules/memberships/service";
import type { StoreMemberRole } from "@/types/database";

export async function requireStoreRole(
  storeId: string,
  allowedRoles: readonly StoreMemberRole[],
): Promise<MembershipRecord> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();
  const membership = await getMembershipForStore(supabase, user.id, storeId);

  if (!membership || !allowedRoles.includes(membership.role)) {
    throw new ForbiddenError();
  }

  return membership;
}
