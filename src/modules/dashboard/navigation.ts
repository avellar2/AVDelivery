import { canManageMenu, canManageSettings } from "@/modules/memberships/roles";
import type { StoreMemberRole } from "@/types/database";

export type DashboardNavItem = {
  key: "overview" | "products" | "orders" | "deliveries" | "staff" | "settings";
  label: string;
  href: string | null;
  available: boolean;
  locked?: boolean;
  description: string;
};

export function getDashboardNavItems(role: StoreMemberRole | null): DashboardNavItem[] {
  const canManage = role ? canManageSettings(role) : false;
  const canManageProducts = role ? canManageMenu(role) : false;

  return [
    {
      key: "overview",
      label: "Visão geral",
      href: "/dashboard",
      available: true,
      description: "Resumo do estabelecimento",
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
      href: null,
      available: false,
      description: "Acompanhamento em tempo real",
    },
    {
      key: "deliveries",
      label: "Entregas",
      href: null,
      available: false,
      description: "Rotas e entregadores",
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
