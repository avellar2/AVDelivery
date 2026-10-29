import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Brand } from "@/components/layout/brand";
import { DashboardNav } from "@/components/layout/dashboard-nav";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { StoreSwitcher } from "@/components/layout/store-switcher";
import { getInitials } from "@/lib/utils";
import type { DashboardNavItem } from "@/modules/dashboard/navigation";
import { roleLabel } from "@/modules/memberships/roles";
import type { StoreMembershipSummary } from "@/modules/memberships/resolve-active-store";

export function DashboardShell({
  profileName,
  email,
  memberships,
  activeMembership,
  navItems,
  isAdmin,
  children,
}: {
  profileName: string;
  email: string;
  memberships: StoreMembershipSummary[];
  activeMembership: StoreMembershipSummary | null;
  navItems: DashboardNavItem[];
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[272px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-zinc-200 bg-white lg:flex">
        <div className="border-b border-zinc-100 px-5 py-5">
          <Brand href="/dashboard" />
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <div className="space-y-2">
            <p className="px-2 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
              Estabelecimento
            </p>
            {activeMembership ? (
              <>
                <p className="truncate px-2 text-sm font-semibold text-zinc-900">
                  {activeMembership.storeName}
                </p>
                <div className="flex flex-wrap items-center gap-2 px-2">
                  <Badge variant="brand">{roleLabel(activeMembership.role)}</Badge>
                  {activeMembership.storeActive ? null : (
                    <Badge variant="warning">Loja inativa</Badge>
                  )}
                </div>
              </>
            ) : (
              <p className="px-2 text-sm text-zinc-500">Nenhuma loja selecionada</p>
            )}
            {memberships.length > 1 ? (
              <div className="px-2 pt-2">
                <StoreSwitcher
                  memberships={memberships}
                  activeStoreId={activeMembership?.storeId ?? null}
                />
              </div>
            ) : null}
          </div>

          <DashboardNav items={navItems} />
        </div>

        <div className="border-t border-zinc-100 p-4">
          {isAdmin ? (
            <Link
              href="/admin"
              className="mb-3 block rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-800 transition-colors hover:bg-orange-100"
            >
              Administração da plataforma
            </Link>
          ) : null}

          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600">
              {getInitials(profileName)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-900">{profileName}</p>
              <p className="truncate text-xs text-zinc-500">{email}</p>
            </div>
          </div>

          <SignOutButton className="mt-3" />
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="border-b border-zinc-200 bg-white lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <Brand href="/dashboard" />
            <div className="flex items-center gap-2">
              {activeMembership ? (
                <Badge variant="brand">{roleLabel(activeMembership.role)}</Badge>
              ) : null}
              <SignOutButton variant="ghost" className="w-auto" fullWidth={false} />
            </div>
          </div>
          <div className="px-4 pb-2">
            <DashboardNav items={navItems} orientation="horizontal" />
          </div>
          {memberships.length > 1 ? (
            <div className="border-t border-zinc-100 px-4 py-2">
              <StoreSwitcher
                memberships={memberships}
                activeStoreId={activeMembership?.storeId ?? null}
              />
            </div>
          ) : null}
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
