import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { OrdersBoard } from "@/components/dashboard/orders-board";
import {
  canAssignDeliveries,
  canCancelOrders,
  canManagePayments,
  canOperateOrders,
  roleLabel,
} from "@/modules/memberships/roles";
import { listDriversForStore } from "@/modules/deliveries/service";
import { listOrdersForStore } from "@/modules/orders/service";
import { getDashboardContext } from "@/modules/stores/active-store";

export const metadata = { title: "Pedidos" };
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const { access } = await getDashboardContext();

  if (access.status !== "active") {
    redirect("/dashboard");
  }

  const membership = access.membership;

  if (!canOperateOrders(membership.role)) {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Pedidos</h1>
          <p className="text-sm text-zinc-500">{membership.storeName}</p>
        </header>

        <Alert variant="warning" title="Acesso restrito">
          O perfil {roleLabel(membership.role)} não pode operar pedidos. Fale com o proprietário ou
          gerente da loja para solicitar acesso.
        </Alert>
      </div>
    );
  }

  const orders = await listOrdersForStore(membership.storeId, null);
  const canManageDeliveries = canAssignDeliveries(membership.role);
  const drivers = canManageDeliveries ? await listDriversForStore(membership.storeId) : [];

  return (
    <OrdersBoard
      storeName={membership.storeName}
      initialOrders={orders}
      initialDrivers={drivers}
      canCancel={canCancelOrders(membership.role)}
      canManagePayments={canManagePayments(membership.role)}
      canManageDeliveries={canManageDeliveries}
    />
  );
}
