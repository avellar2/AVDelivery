import type { StoreMemberRole } from "@/types/database";

export type StoreMembershipSummary = {
  membershipId: string;
  storeId: string;
  storeName: string;
  storeSlug: string;
  storeActive: boolean;
  role: StoreMemberRole;
};

export type ActiveStoreResolution =
  | { status: "none" }
  | { status: "choose" }
  | { status: "active"; membership: StoreMembershipSummary };

export function resolveActiveStore(
  memberships: readonly StoreMembershipSummary[],
  requestedStoreId: string | null | undefined,
): ActiveStoreResolution {
  if (memberships.length === 0) {
    return { status: "none" };
  }

  if (requestedStoreId) {
    const requested = memberships.find((membership) => membership.storeId === requestedStoreId);

    if (requested) {
      return { status: "active", membership: requested };
    }
  }

  if (memberships.length === 1) {
    return { status: "active", membership: memberships[0] };
  }

  return { status: "choose" };
}
