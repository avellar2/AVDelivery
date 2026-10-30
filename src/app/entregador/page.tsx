import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { DriverPanel } from "@/components/deliveries/driver-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ACTIVE_STORE_COOKIE } from "@/modules/stores/active-store";
import { getDashboardContext } from "@/modules/stores/active-store";
import { selectDriverStoreAction } from "@/modules/deliveries/actions";
import { resolveDriverStore } from "@/modules/deliveries/driver-store";
import {
  getDriverDeliveriesForStore,
  getDriverProfileForStore,
} from "@/modules/deliveries/service";

export const metadata: Metadata = {
  title: "Minhas entregas",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function DriverPage() {
  const { user, profileName, memberships } = await getDashboardContext();
  const cookieStore = await cookies();
  const resolution = resolveDriverStore(
    memberships,
    cookieStore.get(ACTIVE_STORE_COOKIE)?.value ?? null,
  );

  if (resolution.status === "none") {
    return (
      <div className="mx-auto w-full max-w-lg space-y-4">
        <header className="space-y-1">
          <p className="text-sm text-zinc-500">Olá, {profileName}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Área do entregador</h1>
        </header>
        <EmptyState
          title="Nenhuma loja com acesso de entregador"
          description={`O e-mail ${user.email ?? ""} não está vinculado como entregador em nenhum estabelecimento. Solicite ao gestor da loja o cadastro na equipe de entrega.`}
        />
        <Link href="/dashboard" className="text-sm font-medium text-orange-700">
          Ir para o painel
        </Link>
      </div>
    );
  }

  if (resolution.status === "choose") {
    return (
      <div className="mx-auto w-full max-w-lg space-y-5">
        <header className="space-y-1">
          <p className="text-sm text-zinc-500">Olá, {profileName}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Escolha a loja</h1>
          <p className="text-sm text-zinc-500">
            Você entrega em {resolution.memberships.length} estabelecimentos. Selecione onde vai
            trabalhar agora.
          </p>
        </header>

        <div className="grid gap-3">
          {resolution.memberships.map((membership) => (
            <Card key={membership.storeId}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-zinc-900">{membership.storeName}</p>
                  <Badge variant={membership.storeActive ? "success" : "warning"}>
                    {membership.storeActive ? "Loja ativa" : "Loja inativa"}
                  </Badge>
                </div>
                <form action={selectDriverStoreAction}>
                  <input type="hidden" name="storeId" value={membership.storeId} />
                  <Button type="submit" variant="secondary">
                    Entregar nesta loja
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const membership = resolution.membership;

  if (!membership.storeActive) {
    return (
      <div className="mx-auto w-full max-w-lg space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{membership.storeName}</h1>
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Esta loja está inativa. As entregas ficam indisponíveis até o estabelecimento ser
          reativado.
        </p>
      </div>
    );
  }

  const driver = await getDriverProfileForStore(user.id, membership.storeId);

  if (!driver) {
    return (
      <div className="mx-auto w-full max-w-lg space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{membership.storeName}</h1>
        <EmptyState
          title="Perfil de entregador não configurado"
          description="Seu vínculo existe, mas o perfil operacional ainda não foi criado. Peça ao gestor para concluir o cadastro em Entregadores."
        />
      </div>
    );
  }

  if (!driver.active) {
    return (
      <div className="mx-auto w-full max-w-lg space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{membership.storeName}</h1>
        <EmptyState
          title="Acesso de entregador desativado"
          description="Seu cadastro está inativo nesta loja. Fale com o gestor para reativar o acesso."
        />
      </div>
    );
  }

  const deliveries = await getDriverDeliveriesForStore(user.id, membership.storeId);
  const driverMemberships = memberships.filter((item) => item.role === "driver");

  return (
    <div className="space-y-4">
      {driverMemberships.length > 1 ? (
        <form action={selectDriverStoreAction} className="flex items-center gap-2">
          <label htmlFor="driverStore" className="text-sm font-medium text-zinc-700">
            Loja
          </label>
          <select
            id="driverStore"
            name="storeId"
            defaultValue={membership.storeId}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
          >
            {driverMemberships.map((item) => (
              <option key={item.storeId} value={item.storeId}>
                {item.storeName}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary" className="px-3 py-2">
            Trocar
          </Button>
        </form>
      ) : null}

      <DriverPanel
        storeId={membership.storeId}
        storeName={membership.storeName}
        driverName={driver.displayName}
        initialDeliveries={deliveries}
      />
    </div>
  );
}
