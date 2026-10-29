import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { buttonClassName } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { canManageSettings, canToggleStoreActive } from "@/modules/memberships/roles";
import { getDashboardContext } from "@/modules/stores/active-store";
import { getStoreSettings } from "@/modules/stores/service";
import { StoreSettingsForm } from "@/app/dashboard/configuracoes/store-settings-form";

export default async function StoreSettingsPage() {
  const { access } = await getDashboardContext();

  if (access.status !== "active") {
    redirect("/dashboard");
  }

  const membership = access.membership;

  if (!canManageSettings(membership.role)) {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
          <p className="text-sm text-zinc-500">{membership.storeName}</p>
        </header>

        <Alert variant="error" title="Acesso restrito">
          Apenas proprietários e gerentes podem alterar as configurações da loja.
        </Alert>

        <Link href="/dashboard" className={buttonClassName("secondary")}>
          Voltar para o painel
        </Link>
      </div>
    );
  }

  const store = await getStoreSettings(membership.storeId);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Configurações da loja</h1>
          <p className="text-sm text-zinc-500">
            Dados públicos de <span className="font-medium text-zinc-700">{store.name}</span>.
          </p>
        </div>

        <Link
          href={`/loja/${store.slug}`}
          target="_blank"
          rel="noreferrer"
          className={buttonClassName("secondary")}
        >
          Ver página pública
        </Link>
      </header>

      <Card>
        <CardHeader
          title="Informações públicas"
          description="Esses dados aparecem na página aberta ao público."
        />
        <CardContent>
          <StoreSettingsForm
            store={store}
            canToggleActive={canToggleStoreActive(membership.role)}
          />
        </CardContent>
      </Card>

      <p className="text-xs text-zinc-500">
        O identificador público da loja não pode ser alterado nesta etapa para não quebrar links já
        divulgados.
      </p>
    </div>
  );
}
