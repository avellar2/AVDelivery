"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import type { MenuManagementData } from "@/modules/menu/types";

import { CategoriesSection } from "./categories-section";
import { OptionsSection } from "./options-section";
import { ProductsSection } from "./products-section";

type MenuTab = "products" | "categories" | "options";

export function MenuManager({ data }: { data: MenuManagementData }) {
  const [tab, setTab] = useState<MenuTab>("products");

  const tabs: { key: MenuTab; label: string; count: number }[] = [
    { key: "products", label: "Produtos", count: data.products.length },
    { key: "categories", label: "Categorias", count: data.categories.length },
    { key: "options", label: "Adicionais", count: data.optionGroups.length },
  ];

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Seções do cardápio"
        className="flex gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-sm"
      >
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            aria-controls={`menu-panel-${item.key}`}
            onClick={() => setTab(item.key)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors",
              tab === item.key
                ? "bg-zinc-900 text-white"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
            )}
          >
            {item.label}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                tab === item.key ? "bg-white/15 text-white" : "bg-zinc-100 text-zinc-500",
              )}
            >
              {item.count}
            </span>
          </button>
        ))}
      </div>

      <div
        id={`menu-panel-${tab}`}
        role="tabpanel"
        aria-label={tabs.find((item) => item.key === tab)?.label}
      >
        {tab === "products" ? (
          <ProductsSection
            data={data}
            onRequestCategories={() => setTab("categories")}
            onRequestOptions={() => setTab("options")}
          />
        ) : null}

        {tab === "categories" ? <CategoriesSection data={data} /> : null}

        {tab === "options" ? <OptionsSection data={data} /> : null}
      </div>
    </div>
  );
}
