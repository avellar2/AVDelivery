import type { Metadata } from "next";

import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getDashboardNavItems } from "@/modules/dashboard/navigation";
import { isPlatformAdmin } from "@/modules/platform-admin/guard";
import { getDashboardContext } from "@/modules/stores/active-store";

export const metadata: Metadata = { title: "Painel" };
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, profileName, memberships, access } = await getDashboardContext();
  const activeMembership = access.status === "active" ? access.membership : null;
  const admin = await isPlatformAdmin(user.id);
  const navItems = getDashboardNavItems(activeMembership?.role ?? null);

  return (
    <DashboardShell
      profileName={profileName}
      email={user.email ?? ""}
      memberships={memberships}
      activeMembership={activeMembership}
      navItems={navItems}
      isAdmin={admin}
    >
      {children}
    </DashboardShell>
  );
}
