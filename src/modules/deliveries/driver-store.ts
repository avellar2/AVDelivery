import type { StoreMembershipSummary } from "@/modules/memberships/resolve-active-store";

export type DriverStoreResolution =
  | { status: "active"; membership: StoreMembershipSummary }
  | { status: "choose"; memberships: StoreMembershipSummary[] }
  | { status: "none" };

export function resolveDriverStore(
  memberships: StoreMembershipSummary[],
  requestedStoreId: string | null,
): DriverStoreResolution {
  const driverMemberships = memberships.filter((membership) => membership.role === "driver");

  if (driverMemberships.length === 0) {
    return { status: "none" };
  }

  if (driverMemberships.length === 1) {
    return { status: "active", membership: driverMemberships[0]! };
  }

  const requested = requestedStoreId
    ? driverMemberships.find((membership) => membership.storeId === requestedStoreId)
    : undefined;

  if (requested) {
    return { status: "active", membership: requested };
  }

  return { status: "choose", memberships: driverMemberships };
}
