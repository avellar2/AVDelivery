import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  canAssignDeliveries,
  canManageMenu,
  canManageSettings,
  canOperateOrders,
  isDriver,
  roleLabel,
} from "@/modules/memberships/roles";
import { countDeliveriesForStore } from "@/modules/deliveries/service";
import { countOrdersByStatus } from "@/modules/orders/service";
import { commercialStateLabel } from "@/modules/subscriptions/access";
import { getCommercialStatusBySlug } from "@/modules/subscriptions/service";
import { getDashboardContext } from "@/modules/stores/active-store";
import { selectStoreAction } from "@/modules/stores/actions";

const upcomingModules = [
  {
    title: "Funcionários",
    description: "Convites e permissões da equipe da loja.",
  },
];

export default async function DashboardPage() {
  const { user, profileName, memberships, access } = await getDashboardContext();

  if (access.status === "none") {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <p className="text-sm text-zinc-500">Olá, {profileName}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Nenhuma loja vinculada</h1>
        </header>

        <EmptyState
          title="Sua conta ainda não possui um estabelecimento"
          description={`O e-mail ${user.email ?? ""} não está associado a nenhuma loja. Solicite ao administrador da plataforma o vínculo com o seu estabelecimento.`}
        />
      </div>
    );
  }

  if (access.status === "choose") {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <p className="text-sm text-zinc-500">Olá, {profileName}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Escolha um estabelecimento</h1>
          <p className="text-sm text-zinc-500">
            Sua conta tem acesso a {memberships.length} lojas. Selecione com qual deseja trabalhar
            agora.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          {memberships.map((membership) => (
            <Card key={membership.storeId}>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-zinc-900">{membership.storeName}</h2>
                  <p className="text-sm text-zinc-500">/loja/{membership.storeSlug}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant="brand">{roleLabel(membership.role)}</Badge>
                  <Badge variant={membership.storeActive ? "success" : "warning"}>
                    {membership.storeActive ? "Ativa" : "Inativa"}
                  </Badge>
                </div>

                <form action={selectStoreAction}>
                  <input type="hidden" name="storeId" value={membership.storeId} />
                  <Button type="submit" variant="secondary" className="w-full">
                    Acessar loja
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const membership = access.membership;
  const canManage = canManageSettings(membership.role);
  const canManageProducts = canManageMenu(membership.role);
  const canOperate = canOperateOrders(membership.role);
  const canDeliver = canAssignDeliveries(membership.role);
  const driverAccess = isDriver(membership.role);
  const commercial = await getCommercialStatusBySlug(membership.storeSlug);
  const commercialBlocked = Boolean(membership.storeActive && commercial && !commercial.hasAccess);
  const orderCounts = canOperate ? await countOrdersByStatus(membership.storeId) : null;
  const deliveryCounts =
    canDeliver || driverAccess ? await countDeliveriesForStore(membership.storeId) : null;
  const activeOrders = orderCounts
    ? orderCounts.pending +
      orderCounts.accepted +
      orderCounts.preparing +
      orderCounts.ready +
      orderCounts.out_for_delivery
    : 0;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm text-zinc-500">Olá, {profileName}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{membership.storeName}</h1>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="brand">{roleLabel(membership.role)}</Badge>
            <Badge variant={membership.storeActive ? "success" : "warning"}>
              {membership.storeActive ? "Loja ativa" : "Loja inativa"}
            </Badge>
          </div>
        </div>

        <Link
          href={`/loja/${membership.storeSlug}`}
          target="_blank"
          rel="noreferrer"
          className={buttonClassName("secondary")}
        >
          Ver página pública
        </Link>
      </header>

      {commercialBlocked ? (
        <Alert variant="error" title="Novos pedidos bloqueados">
          A assinatura desta loja está{" "}
          {commercialStateLabel(commercial?.state ?? "missing").toLowerCase()}. Produtos, clientes,
          pedidos anteriores e entregas em andamento continuam preservados, mas novos pedidos são
          recusados até a regularização.{" "}
          {membership.role === "owner" ? (
            <Link
              href="/dashboard/assinatura"
              className="font-semibold underline underline-offset-2"
            >
              Ver assinatura e regularizar
            </Link>
          ) : (
            "Solicite ao proprietário a regularização do acesso."
          )}
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Situação</p>
            <p className="mt-2 text-lg font-semibold">
              {membership.storeActive ? "Publicada" : "Oculta ao público"}
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              {membership.storeActive
                ? "A página pública está acessível pelo link da loja."
                : "A página pública não exibe esta loja enquanto ela estiver inativa."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
              Endereço público
            </p>
            <p className="mt-2 truncate text-lg font-semibold">/loja/{membership.storeSlug}</p>
            <p className="mt-1 text-sm text-zinc-500">
              Divulgue este endereço no Instagram, WhatsApp e Google.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Seu acesso</p>
            <p className="mt-2 text-lg font-semibold">{roleLabel(membership.role)}</p>
            <p className="mt-1 text-sm text-zinc-500">
              {canManage
                ? "Você pode editar o cardápio e os dados públicos da loja."
                : "Você tem acesso de leitura ao painel nesta etapa."}
            </p>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Módulos da operação</h2>
            <p className="text-sm text-zinc-500">
              Cardápio e pedidos disponíveis; os demais módulos chegam nas próximas etapas.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {canManageProducts ? (
            <Card>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-zinc-900">Cardápio</h3>
                  <Badge variant="success">Disponível</Badge>
                </div>
                <p className="text-sm text-zinc-500">Produtos, categorias, adicionais e imagens.</p>
                <Link
                  href="/dashboard/produtos"
                  className="inline-flex text-sm font-medium text-orange-700 hover:text-orange-800"
                >
                  Gerenciar cardápio
                </Link>
              </CardContent>
            </Card>
          ) : null}

          {canOperate ? (
            <Card>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-zinc-900">Pedidos</h3>
                  <Badge variant={activeOrders > 0 ? "warning" : "success"}>
                    {activeOrders > 0 ? `${activeOrders} em andamento` : "Disponível"}
                  </Badge>
                </div>
                <p className="text-sm text-zinc-500">
                  Fila da loja, status, pagamento e retiradas.
                </p>
                <Link
                  href="/dashboard/pedidos"
                  className="inline-flex text-sm font-medium text-orange-700 hover:text-orange-800"
                >
                  Abrir fila de pedidos
                </Link>
              </CardContent>
            </Card>
          ) : null}

          {canDeliver || driverAccess ? (
            <Card>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-zinc-900">
                    {driverAccess ? "Minhas entregas" : "Entregas"}
                  </h3>
                  <Badge
                    variant={deliveryCounts && deliveryCounts.active > 0 ? "warning" : "success"}
                  >
                    {deliveryCounts && deliveryCounts.active > 0
                      ? `${deliveryCounts.active} em rota`
                      : "Disponível"}
                  </Badge>
                </div>
                <p className="text-sm text-zinc-500">
                  {driverAccess
                    ? "Pedidos atribuídos a você, coleta e confirmação."
                    : "Entregadores, atribuições e histórico de entregas."}
                </p>
                <Link
                  href={driverAccess ? "/entregador" : "/dashboard/entregadores"}
                  className="inline-flex text-sm font-medium text-orange-700 hover:text-orange-800"
                >
                  {driverAccess ? "Abrir minhas entregas" : "Gerenciar entregadores"}
                </Link>
              </CardContent>
            </Card>
          ) : null}

          {upcomingModules.map((module) => (
            <Card key={module.title}>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-zinc-900">{module.title}</h3>
                  <Badge variant="muted">Em breve</Badge>
                </div>
                <p className="text-sm text-zinc-500">{module.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {canManage ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Configurações da loja</h2>
              <p className="text-sm text-zinc-500">
                Atualize nome, descrição, telefone, logo e a visibilidade pública.
              </p>
            </div>
            <Link href="/dashboard/configuracoes" className={buttonClassName("primary")}>
              Abrir configurações
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
