"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import type { PublicMenuOptionGroup, PublicMenuProduct } from "@/modules/menu/types";
import { groupSelectionError } from "@/modules/menu/validation";
import { MAX_ITEM_NOTES, MAX_ITEM_QUANTITY } from "@/modules/orders/constants";
import type { CartLine } from "@/modules/orders/types";

export type NewCartLine = Omit<CartLine, "key">;

function optionErrorMessage(groups: PublicMenuOptionGroup[], selections: Record<string, string[]>) {
  if (groups.length === 0) {
    return "Selecione os adicionais.";
  }

  return (
    groups
      .map((group) => groupSelectionError(group, (selections[group.id] ?? []).length))
      .find((message): message is string => Boolean(message)) ?? null
  );
}

function panelTotalCents(
  product: PublicMenuProduct,
  groups: PublicMenuOptionGroup[],
  selections: Record<string, string[]>,
  quantity: number,
): number {
  let total = product.priceCents;

  for (const group of groups) {
    for (const optionId of selections[group.id] ?? []) {
      const option = group.options.find((entry) => entry.id === optionId);

      if (option) {
        total += option.additionalPriceCents;
      }
    }
  }

  return total * quantity;
}

export function ProductCustomizer({
  product,
  disabled,
  onAdd,
}: {
  product: PublicMenuProduct;
  disabled: boolean;
  onAdd: (line: NewCartLine) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const panelId = `product-customizer-${product.id}`;
  const hasGroups = product.optionGroups.length > 0;
  const selectionError = optionErrorMessage(product.optionGroups, selections);
  const totalCents = panelTotalCents(product, product.optionGroups, selections, quantity);

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

  function addToCart(line: NewCartLine) {
    onAdd(line);
    setSelections({});
    setQuantity(1);
    setNotes("");
    setOpen(false);
  }

  if (!hasGroups) {
    return (
      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        onClick={() =>
          addToCart({
            productId: product.id,
            productName: product.name,
            basePriceCents: product.priceCents,
            quantity: 1,
            notes: "",
            options: [],
          })
        }
        className="w-full sm:w-auto"
      >
        Adicionar ao carrinho
      </Button>
    );
  }

  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="w-full sm:w-auto"
      >
        {open ? "Fechar opções" : "Personalizar"}
      </Button>

      {open ? (
        <div
          id={panelId}
          className="mt-3 space-y-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4"
        >
          {product.optionGroups.map((group) => {
            const selected = selections[group.id] ?? [];
            const atLimit = selected.length >= group.maxSelect;
            const error = groupSelectionError(group, selected.length);

            return (
              <fieldset key={group.id} className="space-y-2">
                <legend className="text-sm font-semibold text-zinc-900">
                  {group.name}
                  {group.required || group.minSelect > 0 ? " *" : ""}
                  <span className="ml-2 text-xs font-normal text-zinc-500">
                    {group.maxSelect === 1
                      ? "escolha 1"
                      : `escolha de ${group.minSelect} a ${group.maxSelect}`}
                  </span>
                </legend>

                <div className="space-y-2">
                  {group.options.map((option) => {
                    const checked = selected.includes(option.id);
                    const optionDisabled = disabled || (!checked && atLimit && group.maxSelect > 1);

                    return (
                      <label
                        key={option.id}
                        className={cn(
                          "flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800",
                          optionDisabled && "cursor-not-allowed opacity-60",
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={optionDisabled}
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

          <div className="space-y-3 border-t border-zinc-200 pt-3">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-zinc-700">Observação do item</span>
              <input
                type="text"
                value={notes}
                maxLength={MAX_ITEM_NOTES}
                disabled={disabled}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Ex.: sem cebola, ponto da carne..."
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
              />
            </label>

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-600">Quantidade</span>
                <div className="flex items-center rounded-lg border border-zinc-300 bg-white">
                  <button
                    type="button"
                    aria-label="Diminuir quantidade do item"
                    disabled={disabled || quantity <= 1}
                    onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                    className="px-3 py-1.5 text-base font-semibold text-zinc-600 disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="min-w-8 text-center text-sm font-semibold text-zinc-900">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    aria-label="Aumentar quantidade do item"
                    disabled={disabled || quantity >= MAX_ITEM_QUANTITY}
                    onClick={() => setQuantity((value) => Math.min(MAX_ITEM_QUANTITY, value + 1))}
                    className="px-3 py-1.5 text-base font-semibold text-zinc-600 disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="text-right">
                <p className="text-xs text-zinc-500">Total do item</p>
                <p className="text-lg font-semibold text-zinc-900">{formatCurrency(totalCents)}</p>
              </div>
            </div>
          </div>

          <Button
            type="button"
            disabled={disabled || Boolean(selectionError)}
            onClick={() =>
              addToCart({
                productId: product.id,
                productName: product.name,
                basePriceCents: product.priceCents,
                quantity,
                notes: notes.trim().slice(0, MAX_ITEM_NOTES),
                options: product.optionGroups.flatMap((group) =>
                  (selections[group.id] ?? []).flatMap((optionId) => {
                    const option = group.options.find((entry) => entry.id === optionId);

                    if (!option) {
                      return [];
                    }

                    return [
                      {
                        groupId: group.id,
                        groupName: group.name,
                        optionId: option.id,
                        name: option.name,
                        priceCents: option.additionalPriceCents,
                        quantity: 1,
                      },
                    ];
                  }),
                ),
              })
            }
            className="w-full"
          >
            Adicionar ao carrinho
          </Button>
        </div>
      ) : null}
    </div>
  );
}
