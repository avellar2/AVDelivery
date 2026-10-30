import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DriversManager } from "@/components/deliveries/drivers-manager";
import { canManageDrivers } from "@/modules/memberships/roles";
import { listDriversForStore } from "@/modules/deliveries/service";
import { getActiveMembership } from "@/modules/stores/active-store";

export const metadata: Metadata = { title: "Entregadores" };
export const dynamic = "force-dynamic";

export default async function DriversPage() {
  const membership = await getActiveMembership();

  if (!membership || !canManageDrivers(membership.role)) {
    redirect("/dashboard");
  }

  if (!membership.storeActive) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-900">
        A loja está inativa. Reative o estabelecimento em Configurações para gerenciar entregadores.
      </div>
    );
  }

  const drivers = await listDriversForStore(membership.storeId);

  return <DriversManager storeName={membership.storeName} initialDrivers={drivers} />;
}
