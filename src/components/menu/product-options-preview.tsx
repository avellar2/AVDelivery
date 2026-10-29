"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import type { PublicMenuOptionGroup } from "@/modules/menu/types";
import { groupSelectionError } from "@/modules/menu/validation";

export function ProductOptionsPreview({
  productId,
  productName,
  priceCents,
  groups,
}: {
  productId: string;
  productName: string;
  priceCents: number;
  groups: PublicMenuOptionGroup[];
}) {
  const [open, setOpen] = useState(false);
  const [selections, setSelections] = useState<Record<string, string[]>>({});

  if (groups.length === 0) {
    return null;
  }

  const panelId = `product-options-${productId}`;

  const selectedOptions = groups.flatMap((group) =>
    (selections[group.id] ?? [])
      .map((optionId) => group.options.find((option) => option.id === optionId))
      .filter((option): option is PublicMenuOptionGroup["options"][number] => Boolean(option)),
  );

  const totalCents =
    priceCents + selectedOptions.reduce((total, option) => total + option.additionalPriceCents, 0);

  const selectionErrors = groups
    .map((group) => groupSelectionError(group, (selections[group.id] ?? []).length))
    .filter((message): message is string => Boolean(message));

  function toggleOption(group: PublicMenuOptionGroup, optionId: string) {
    setSelections((previous) => {
      const current = previous[group.id] ?? [];

      if (current.includes(optionId)) {
        return { ...previous, [group.id]: current.filter((id) => id !== optionId) };
      }

      if (group.maxSelect <= 1) {
        return { ...previous, [group.id]: [optionId] };
      }

      if (current.length >= group.maxSelect) {
        return previous;
      }

      return { ...previous, [group.id]: [...current, optionId] };
    });
  }

  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="w-full sm:w-auto"
      >
        {open ? "Fechar prévia" : "Personalizar"}
      </Button>

      {open ? (
        <div
          id={panelId}
          className="mt-3 space-y-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4"
        >
          <p className="text-xs text-zinc-500">
            Prévia do cardápio de {productName}. Nenhum pedido é criado nesta etapa.
          </p>

          {groups.map((group) => {
            const selected = selections[group.id] ?? [];
            const atLimit = selected.length >= group.maxSelect;
            const error = groupSelectionError(group, selected.length);

            return (
              <fieldset key={group.id} className="space-y-2">
                <legend className="text-sm font-semibold text-zinc-900">
                  {group.name}
                  {group.required ? " *" : ""}
                  <span className="ml-2 text-xs font-normal text-zinc-500">
                    {group.maxSelect === 1
                      ? "escolha 1"
                      : `escolha de ${group.minSelect} a ${group.maxSelect}`}
                  </span>
                </legend>

                <div className="space-y-2">
                  {group.options.map((option) => {
                    const checked = selected.includes(option.id);
                    const disabled = !checked && atLimit && group.maxSelect > 1;

                    return (
                      <label
                        key={option.id}
                        className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800"
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleOption(group, option.id)}
                            className="h-4 w-4 rounded border-zinc-300 text-orange-600 focus:ring-orange-500 disabled:opacity-50"
                          />
                          {option.name}
                        </span>
                        <span className="text-xs font-medium text-zinc-500">
                          {option.additionalPriceCents > 0
                            ? `+ ${formatCurrency(option.additionalPriceCents)}`
                            : "Sem custo"}
                        </span>
                      </label>
                    );
                  })}
                </div>

                {error ? (
                  <p className="text-xs font-medium text-amber-700" role="status">
                    {error}
                  </p>
                ) : null}
              </fieldset>
            );
          })}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-3">
            <span className="text-sm text-zinc-500">Total da prévia</span>
            <span className="text-lg font-semibold text-zinc-900">
              {formatCurrency(totalCents)}
            </span>
          </div>

          {selectionErrors.length > 0 ? (
            <p className="text-xs font-medium text-amber-700" role="status">
              Complete as seleções obrigatórias para visualizar o total final.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
