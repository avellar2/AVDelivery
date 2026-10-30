import Link from "next/link";

import { Brand } from "@/components/layout/brand";
import { SignOutButton } from "@/components/layout/sign-out-button";

export const dynamic = "force-dynamic";

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Brand href="/entregador" />
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
            >
              Painel
            </Link>
            <SignOutButton variant="ghost" className="w-auto" fullWidth={false} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
