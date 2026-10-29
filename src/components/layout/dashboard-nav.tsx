"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import type { DashboardNavItem } from "@/modules/dashboard/navigation";

export function DashboardNav({
  items,
  orientation = "vertical",
}: {
  items: DashboardNavItem[];
  orientation?: "vertical" | "horizontal";
}) {
  const pathname = usePathname();
  const horizontal = orientation === "horizontal";

  return (
    <nav
      aria-label="Navegação do painel"
      className={cn(horizontal ? "flex gap-1 overflow-x-auto pb-1" : "space-y-1")}
    >
      {items.map((item) => {
        const base = cn(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          horizontal ? "whitespace-nowrap" : "w-full",
        );

        if (!item.available || !item.href) {
          const unavailableLabel = item.locked ? "Sem permissão" : "Em breve";

          return (
            <span
              key={item.key}
              aria-disabled="true"
              title={
                item.locked
                  ? "Disponível apenas para proprietários e gerentes"
                  : "Disponível em uma próxima etapa"
              }
              className={cn(base, "cursor-not-allowed text-zinc-400")}
            >
              <span>{item.label}</span>
              <span className="ml-auto rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
                {unavailableLabel}
              </span>
            </span>
          );
        }

        const active = pathname === item.href;

        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              base,
              active
                ? "bg-orange-50 text-orange-700"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
