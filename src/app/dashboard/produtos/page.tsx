import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { buttonClassName } from "@/components/ui/button";
import { canManageMenu } from "@/modules/memberships/roles";
import { getMenuManagementData } from "@/modules/menu/service";
import { getDashboardContext } from "@/modules/stores/active-store";

import { MenuManager } from "./menu-manager";

export const metadata: Metadata = { title: "Cardápio" };

export default async function MenuPage() {
  const { access } = await getDashboardContext();

  if (access.status !== "active") {
    redirect("/dashboard");
  }

  const membership = access.membership;

  if (!canManageMenu(membership.role)) {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Cardápio digital</h1>
          <p className="text-sm text-zinc-500">{membership.storeName}</p>
        </header>

        <Alert variant="error" title="Acesso restrito">
          Apenas proprietários e gerentes podem gerenciar o cardápio. Funcionários e entregadores
          mantêm apenas as permissões de leitura já definidas.
        </Alert>

        <Link href="/dashboard" className={buttonClassName("secondary")}>
          Voltar para o painel
        </Link>
      </div>
    );
  }

  const data = await getMenuManagementData(membership.storeId);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Cardápio digital</h1>
          <p className="text-sm text-zinc-500">
            {membership.storeName} · {data.products.length} produto
            {data.products.length === 1 ? "" : "s"} · {data.categories.length} categoria
            {data.categories.length === 1 ? "" : "s"} · {data.optionGroups.length} grupo
            {data.optionGroups.length === 1 ? "" : "s"} de adicionais
          </p>
        </div>

        <Link
          href={`/loja/${membership.storeSlug}`}
          target="_blank"
          rel="noreferrer"
          className={buttonClassName("secondary")}
        >
          Ver cardápio público
        </Link>
      </header>

      {membership.storeActive ? null : (
        <Alert variant="warning" title="Loja inativa">
          A loja está desativada. O cardápio pode ser editado, mas não aparece na página pública
          enquanto a loja estiver inativa.
        </Alert>
      )}

      <MenuManager data={data} />
    </div>
  );
}
