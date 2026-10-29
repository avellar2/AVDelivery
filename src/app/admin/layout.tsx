import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/layout/brand";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { requirePlatformAdmin } from "@/modules/platform-admin/guard";

export const metadata: Metadata = { title: "Administração" };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Brand href="/admin" />
            <Badge variant="brand">Superadministrador</Badge>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
            >
              Painel da loja
            </Link>
            <span className="hidden text-sm text-zinc-500 sm:inline">{user.email}</span>
            <SignOutButton variant="ghost" className="w-auto" fullWidth={false} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
