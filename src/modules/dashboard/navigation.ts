import {
  canAssignDeliveries,
  canManageMenu,
  canManageSettings,
  canOperateOrders,
} from "@/modules/memberships/roles";
import { canViewSubscription } from "@/modules/subscriptions/access";
import type { StoreMemberRole } from "@/types/database";

export type DashboardNavItem = {
  key: "overview" | "subscription" | "products" | "orders" | "deliveries" | "staff" | "settings";
  label: string;
  href: string | null;
  available: boolean;
  locked?: boolean;
  description: string;
};

export function getDashboardNavItems(role: StoreMemberRole | null): DashboardNavItem[] {
  const canManage = role ? canManageSettings(role) : false;
  const canManageProducts = role ? canManageMenu(role) : false;
  const canOperate = role ? canOperateOrders(role) : false;
  const canDeliver = role ? canAssignDeliveries(role) : false;
  const canSeeSubscription = role ? canViewSubscription(role) : false;
  const isDriverRole = role === "driver";

  return [
    {
      key: "overview",
      label: "Visão geral",
      href: "/dashboard",
      available: true,
      description: "Resumo do estabelecimento",
    },
    {
      key: "subscription",
      label: "Assinatura",
      href: canSeeSubscription ? "/dashboard/assinatura" : null,
      available: canSeeSubscription,
      locked: !canSeeSubscription,
      description: "Plano, teste e cobrança",
    },
    {
      key: "products",
      label: "Produtos",
      href: canManageProducts ? "/dashboard/produtos" : null,
      available: canManageProducts,
      locked: !canManageProducts,
      description: "Cardápio, categorias e adicionais",
    },
    {
      key: "orders",
      label: "Pedidos",
      href: canOperate ? "/dashboard/pedidos" : null,
      available: canOperate,
      locked: !canOperate,
      description: "Fila de pedidos e acompanhamento",
    },
    {
      key: "deliveries",
      label: isDriverRole ? "Minhas entregas" : "Entregas",
      href: isDriverRole ? "/entregador" : canDeliver ? "/dashboard/entregadores" : null,
      available: isDriverRole || canDeliver,
      locked: !isDriverRole && !canDeliver,
      description: isDriverRole ? "Suas entregas atribuídas" : "Entregadores e atribuições",
    },
    {
      key: "staff",
      label: "Funcionários",
      href: null,
      available: false,
      description: "Equipe e permissões",
    },
    {
      key: "settings",
      label: "Configurações",
      href: canManage ? "/dashboard/configuracoes" : null,
      available: canManage,
      locked: !canManage,
      description: "Dados públicos da loja",
    },
  ];
}
