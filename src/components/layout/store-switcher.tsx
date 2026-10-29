"use client";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { StoreMembershipSummary } from "@/modules/memberships/resolve-active-store";
import { selectStoreAction } from "@/modules/stores/actions";

export function StoreSwitcher({
  memberships,
  activeStoreId,
  className,
}: {
  memberships: StoreMembershipSummary[];
  activeStoreId: string | null;
  className?: string;
}) {
  if (memberships.length < 2) {
    return null;
  }

  return (
    <form action={selectStoreAction} className={cn("flex items-center gap-2", className)}>
      <label htmlFor="storeId" className="sr-only">
        Estabelecimento
      </label>
      <Select
        id="storeId"
        name="storeId"
        defaultValue={activeStoreId ?? memberships[0]?.storeId}
        className="py-2 text-sm"
      >
        {memberships.map((membership) => (
          <option key={membership.storeId} value={membership.storeId}>
            {membership.storeName}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="secondary" className="shrink-0 px-3 py-2">
        Trocar
      </Button>
    </form>
  );
}
