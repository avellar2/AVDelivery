"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import { ProductCustomizer, type NewCartLine } from "@/components/storefront/product-customizer";
import {
  CartDrawer,
  type CheckoutAttempt,
  type Confirmation,
  type DrawerStep,
} from "@/components/storefront/cart-drawer";
import { formatCurrency, getInitials } from "@/lib/utils";
import type { PublicMenuCategory, PublicMenuStore } from "@/modules/menu/types";
import {
  cartSubtotalCents,
  readStoredCart,
  reconcileCart,
  writeStoredCart,
  writeTrackingToken,
} from "@/modules/orders/cart";
import { MAX_ITEM_QUANTITY, MAX_ORDER_ITEMS } from "@/modules/orders/constants";
import type { CartLine } from "@/modules/orders/types";

function lineSignature(line: Pick<CartLine, "productId" | "notes" | "options">): string {
  const options = [...line.options]
    .sort((left, right) => left.optionId.localeCompare(right.optionId))
    .map((option) => `${option.groupId}:${option.optionId}:${option.quantity}`)
    .join("|");

  return `${line.productId}::${line.notes.trim()}::${options}`;
}

export function Storefront({
  store,
  categories,
  hasCommercialAccess,
}: {
  store: PublicMenuStore;
  categories: PublicMenuCategory[];
  hasCommercialAccess: boolean;
}) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [step, setStep] = useState<DrawerStep>("cart");
  const [attempt, setAttempt] = useState<CheckoutAttempt | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const subtotalCents = useMemo(() => cartSubtotalCents(lines), [lines]);
  const itemCount = useMemo(() => lines.reduce((total, line) => total + line.quantity, 0), [lines]);
  const acceptingOrders = store.acceptingOrders && hasCommercialAccess;

  useEffect(() => {
    let cancelled = false;

    // O localStorage só existe no navegador: reidrata o carrinho depois da montagem.
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      const stored = readStoredCart(store.id);
      const result = reconcileCart(stored, categories);

      setLines(result.lines);
      writeStoredCart(store.id, result.lines);
      setHydrated(true);

      if (result.changed && stored.length > 0) {
        setNotice(
          result.removed > 0
            ? "Alguns itens saíram do cardápio e foram removidos do carrinho. Confira os valores atualizados."
            : "Os valores do seu carrinho foram atualizados com o cardápio atual.",
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [store.id, categories]);

  useEffect(() => {
    if (hydrated) {
      writeStoredCart(store.id, lines);
    }
  }, [lines, hydrated, store.id]);

  useEffect(() => {
    if (!flash) {
      return;
    }

    const timeout = window.setTimeout(() => setFlash(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [flash]);

  function addLine(line: NewCartLine) {
    const signature = lineSignature(line);
    const existing = lines.find((entry) => lineSignature(entry) === signature);

    if (!existing && lines.length >= MAX_ORDER_ITEMS) {
      setFlash("O carrinho atingiu o limite de itens. Finalize ou remova um item.");
      return;
    }

    if (existing) {
      setLines((previous) =>
        previous.map((entry) =>
          entry.key === existing.key
            ? { ...entry, quantity: Math.min(MAX_ITEM_QUANTITY, entry.quantity + line.quantity) }
            : entry,
        ),
      );
    } else {
      const key =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      setLines((previous) => [...previous, { ...line, key }]);
    }

    setAttempt(null);
    setConfirmation(null);
    setNotice(null);
    setStep("cart");
  }

  function updateQuantity(key: string, quantity: number) {
    setAttempt(null);

    if (quantity < 1) {
      setLines((previous) => previous.filter((line) => line.key !== key));
      return;
    }

    setLines((previous) =>
      previous.map((line) =>
        line.key === key ? { ...line, quantity: Math.min(quantity, MAX_ITEM_QUANTITY) } : line,
      ),
    );
  }

  function removeLine(key: string) {
    setAttempt(null);
    setLines((previous) => previous.filter((line) => line.key !== key));
  }

  function clearCart() {
    setLines([]);
    setAttempt(null);
    setConfirmation(null);
    setStep("cart");
    setNotice(null);
    writeStoredCart(store.id, []);
  }

  function openCart() {
    if (step === "done" && !confirmation) {
      setStep("cart");
    }

    setCartOpen(true);
  }

  function handleConfirmed(nextConfirmation: Confirmation) {
    writeTrackingToken(
      store.slug,
      nextConfirmation.order.orderNumber,
      nextConfirmation.trackingToken,
    );
    setConfirmation(nextConfirmation);
    setLines([]);
    setAttempt(null);
    setFlash(null);
  }

  return (
    <div className="space-y-6 pb-28">
      <header className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <span className="text-xs font-semibold tracking-[0.15em] text-zinc-500 uppercase">
          Loja online
        </span>
        <a href="/login" className="text-sm font-medium text-orange-700 hover:text-orange-800">
          Acesso do estabelecimento
        </a>
      </header>

      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 sm:px-6">
        <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="h-24 bg-gradient-to-r from-orange-500 via-orange-400 to-amber-300" />
          <div className="-mt-8 px-5 pb-5 sm:px-6 sm:pb-6">
            <div className="grid h-16 w-16 place-items-center rounded-2xl border-4 border-white bg-zinc-900 text-xl font-bold text-white shadow-sm">
              {getInitials(store.name)}
            </div>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
                  {store.name}
                </h1>
                {store.description ? (
                  <p className="mt-1 max-w-xl text-sm leading-relaxed text-zinc-600">
                    {store.description}
                  </p>
                ) : null}
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  acceptingOrders
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {acceptingOrders
                  ? "Aceitando pedidos"
                  : store.acceptingOrders
                    ? "Novas vendas indisponíveis"
                    : "Pedidos pausados"}
              </span>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {store.phone ? (
                <a
                  href={`tel:${store.phone.replace(/[^0-9+]/g, "")}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50"
                >
                  {store.phone}
                </a>
              ) : null}

              {store.deliveryEnabled ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-600">
                  Entrega
                  {store.deliveryFeeCents > 0
                    ? ` · ${formatCurrency(store.deliveryFeeCents)}`
                    : " grátis"}
                </span>
              ) : null}

              {store.pickupEnabled ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-600">
                  Retirada no local
                </span>
              ) : null}

              {store.minOrderCents > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-600">
                  Pedido mínimo {formatCurrency(store.minOrderCents)}
                </span>
              ) : null}
            </div>
          </div>
        </section>

        {!store.acceptingOrders ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            A loja está com os pedidos pausados neste momento. Você pode montar o carrinho, mas não
            será possível finalizar até que ela reabra.
          </div>
        ) : !hasCommercialAccess ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Esta loja está temporariamente sem novas vendas pelo site. Você pode consultar o
            cardápio, mas não será possível finalizar pedidos até a regularização pelo
            estabelecimento.
          </div>
        ) : null}

        {categories.length > 0 ? (
          <>
            <nav
              aria-label="Categorias do cardápio"
              className="sticky top-0 z-10 -mx-4 overflow-x-auto border-y border-zinc-200 bg-zinc-50/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-xl sm:border"
            >
              <div className="flex gap-2">
                {categories.map((category) => (
                  <a
                    key={category.id}
                    href={`#categoria-${category.id}`}
                    className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-zinc-700 shadow-sm hover:border-orange-200 hover:text-orange-700"
                  >
                    {category.name}
                  </a>
                ))}
              </div>
            </nav>

            <div className="space-y-8">
              {categories.map((category) => (
                <section key={category.id} id={`categoria-${category.id}`} className="scroll-mt-24">
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                    <div className="space-y-1">
                      <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
                        {category.name}
                      </h2>
                      {category.description ? (
                        <p className="text-sm text-zinc-500">{category.description}</p>
                      ) : null}
                    </div>
                    <span className="text-xs text-zinc-500">
                      {category.products.length} item{category.products.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    {category.products.map((product) => (
                      <article
                        key={product.id}
                        className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
                      >
                        <div className="relative aspect-[4/3] w-full bg-zinc-100">
                          {product.imageUrl ? (
                            <Image
                              src={product.imageUrl}
                              alt={`Foto de ${product.name}`}
                              fill
                              sizes="(max-width: 768px) 100vw, 50vw"
                              className="object-cover"
                            />
                          ) : (
                            <div className="grid h-full w-full place-items-center bg-gradient-to-br from-orange-50 to-amber-50">
                              <span className="text-3xl font-semibold text-orange-200">
                                {getInitials(product.name)}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="space-y-3 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="text-base font-semibold text-zinc-900">
                              {product.name}
                            </h3>
                            <span className="text-base font-semibold whitespace-nowrap text-orange-700">
                              {formatCurrency(product.priceCents)}
                            </span>
                          </div>

                          {product.description ? (
                            <p className="text-sm leading-relaxed text-zinc-600">
                              {product.description}
                            </p>
                          ) : null}

                          <ProductCustomizer product={product} disabled={false} onAdd={addLine} />
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
            <p className="text-sm font-semibold text-zinc-800">Cardápio em preparação</p>
            <p className="mt-1 text-sm text-zinc-500">
              Esta loja ainda não publicou produtos. Em breve você poderá conferir o cardápio
              completo por aqui.
            </p>
          </div>
        )}

        <p className="pb-4 text-center text-xs text-zinc-400">
          Página pública gerada pela AV Delivery
        </p>
      </div>

      {hydrated && lines.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] backdrop-blur">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3">
            <div>
              <p className="text-xs text-zinc-500">
                {itemCount} {itemCount === 1 ? "item" : "itens"} no carrinho
              </p>
              <p className="text-base font-semibold text-zinc-900">
                {formatCurrency(subtotalCents)}
              </p>
            </div>
            <button
              type="button"
              onClick={openCart}
              className="rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-orange-700"
            >
              Ver carrinho
            </button>
          </div>
        </div>
      ) : null}

      {flash ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 bottom-20 z-40 mx-auto w-fit max-w-[90vw] rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white shadow-lg"
        >
          {flash}
        </div>
      ) : null}

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        store={store}
        hasCommercialAccess={hasCommercialAccess}
        lines={lines}
        step={step}
        onStep={setStep}
        onUpdateQuantity={updateQuantity}
        onRemove={removeLine}
        onClear={clearCart}
        attempt={attempt}
        onCreateAttempt={setAttempt}
        confirmation={confirmation}
        onConfirmed={handleConfirmed}
        notice={notice}
      />
    </div>
  );
}
