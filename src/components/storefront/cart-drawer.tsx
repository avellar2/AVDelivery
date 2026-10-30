"use client";

import { useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { zodFieldErrors } from "@/lib/action-state";
import { cn, formatCurrency } from "@/lib/utils";
import type { PublicMenuStore } from "@/modules/menu/types";
import { createOrderAction } from "@/modules/orders/actions";
import {
  buildCheckoutInput,
  cartLineTotal,
  cartLineUnitPriceCents,
  cartSubtotalCents,
  cartTotals,
  createIdempotencyKey,
  createTrackingToken,
} from "@/modules/orders/cart";
import {
  FULFILLMENT_LABELS,
  MAX_ITEM_QUANTITY,
  MAX_ORDER_NOTES,
  PAYMENT_METHOD_LABELS,
} from "@/modules/orders/constants";
import type {
  CartLine,
  CheckoutAddress,
  CheckoutInput,
  CreateOrderResult,
} from "@/modules/orders/types";
import { checkoutInputSchema } from "@/modules/orders/validation";
import type { OrderFulfillmentType, OrderPaymentMethod, OrderStatus } from "@/types/database";

export type DrawerStep = "cart" | "checkout" | "review" | "done";

export type CheckoutAttempt = {
  idempotencyKey: string;
  trackingToken: string;
};

export type PlacedOrder = Extract<CreateOrderResult, { ok: true }>["order"];

export type Confirmation = {
  order: PlacedOrder;
  lines: CartLine[];
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  fulfillmentType: OrderFulfillmentType;
  paymentMethod: OrderPaymentMethod;
  address: CheckoutAddress | null;
  trackingToken: string;
};

const emptyAddress: CheckoutAddress = {
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  reference: "",
  postalCode: "",
};

const STEP_TITLES: Record<DrawerStep, string> = {
  cart: "Seu carrinho",
  checkout: "Finalizar pedido",
  review: "Revisar pedido",
  done: "Pedido confirmado",
};

function errorFor(errors: Record<string, string[]>, key: string): string | undefined {
  const direct = errors[key]?.[0];

  if (direct) {
    return direct;
  }

  return Object.entries(errors).find(([path]) => path.startsWith(`${key}.`))?.[1][0];
}

function whatsappNumber(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  return digits.length <= 11 ? `55${digits}` : digits;
}

function trackingUrl(storeSlug: string, orderNumber: number, token: string): string {
  return `/loja/${storeSlug}/pedido/${orderNumber}#t=${token}`;
}

function whatsappMessage(store: PublicMenuStore, confirmation: Confirmation): string {
  const { order, lines } = confirmation;

  const items = lines
    .map((line) => {
      const options = line.options.length
        ? ` (${line.options.map((option) => option.name).join(", ")})`
        : "";
      return `${line.quantity}x ${line.productName}${options} — ${formatCurrency(cartLineTotal(line))}`;
    })
    .join("\n");

  return [
    `Olá! Fiz o pedido #${order.orderNumber} pelo cardápio de ${store.name}.`,
    "",
    items,
    "",
    `Subtotal: ${formatCurrency(confirmation.subtotalCents)}`,
    confirmation.deliveryFeeCents > 0
      ? `Taxa de entrega: ${formatCurrency(confirmation.deliveryFeeCents)}`
      : null,
    `Total: ${formatCurrency(confirmation.totalCents)}`,
    `Pagamento: ${PAYMENT_METHOD_LABELS[confirmation.paymentMethod]}`,
    `Recebimento: ${FULFILLMENT_LABELS[confirmation.fulfillmentType]}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
      {status === "pending" ? "Aguardando confirmação" : "Pedido atualizado"}
    </span>
  );
}

export function CartDrawer({
  open,
  onClose,
  store,
  lines,
  step,
  onStep,
  onUpdateQuantity,
  onRemove,
  onClear,
  attempt,
  onCreateAttempt,
  confirmation,
  onConfirmed,
  notice,
}: {
  open: boolean;
  onClose: () => void;
  store: PublicMenuStore;
  lines: CartLine[];
  step: DrawerStep;
  onStep: (step: DrawerStep) => void;
  onUpdateQuantity: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  attempt: CheckoutAttempt | null;
  onCreateAttempt: (attempt: CheckoutAttempt) => void;
  confirmation: Confirmation | null;
  onConfirmed: (confirmation: Confirmation) => void;
  notice: string | null;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [fulfillmentType, setFulfillmentType] = useState<OrderFulfillmentType>(
    store.deliveryEnabled ? "delivery" : "pickup",
  );
  const [address, setAddress] = useState<CheckoutAddress>(emptyAddress);
  const [paymentMethod, setPaymentMethod] = useState<OrderPaymentMethod>(
    store.paymentPixEnabled && store.pixKey
      ? "pix"
      : store.paymentCashEnabled
        ? "cash"
        : "card_on_delivery",
  );
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<CheckoutInput | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const deliveryAvailable = store.deliveryEnabled;
  const pickupAvailable = store.pickupEnabled;
  const paymentOptions: { value: OrderPaymentMethod; label: string; hint: string }[] = [];

  if (store.paymentPixEnabled && store.pixKey) {
    paymentOptions.push({
      value: "pix",
      label: PAYMENT_METHOD_LABELS.pix,
      hint: store.pixReceiverName
        ? `Chave de ${store.pixReceiverName}. Envie o comprovante pelo WhatsApp.`
        : "Pague pela chave Pix e envie o comprovante pelo WhatsApp.",
    });
  }

  if (store.paymentCashEnabled) {
    paymentOptions.push({
      value: "cash",
      label: PAYMENT_METHOD_LABELS.cash,
      hint: "Combine o troco com o estabelecimento.",
    });
  }

  if (store.paymentCardOnDeliveryEnabled) {
    paymentOptions.push({
      value: "card_on_delivery",
      label: PAYMENT_METHOD_LABELS.card_on_delivery,
      hint: "O cartão é passado na maquininha no recebimento.",
    });
  }

  const checkoutAvailable =
    store.acceptingOrders && (deliveryAvailable || pickupAvailable) && paymentOptions.length > 0;

  const effectiveFulfillment: OrderFulfillmentType = deliveryAvailable
    ? fulfillmentType
    : pickupAvailable
      ? "pickup"
      : "delivery";

  const totals = cartTotals(lines, effectiveFulfillment, store);
  const subtotalCents = cartSubtotalCents(lines);
  const canReview = totals.meetsMinimum && lines.length > 0 && checkoutAvailable;

  useEffect(() => {
    if (!open) {
      return;
    }

    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  function setAddressField(field: keyof CheckoutAddress, value: string) {
    setAddress((previous) => ({ ...previous, [field]: value }));
  }

  function goToCheckout() {
    if (!checkoutAvailable) {
      return;
    }

    if (deliveryAvailable && !pickupAvailable) {
      setFulfillmentType("delivery");
    } else if (!deliveryAvailable && pickupAvailable) {
      setFulfillmentType("pickup");
    }

    setError(null);
    setFieldErrors({});
    onStep("checkout");
  }

  function reviewOrder() {
    const input = buildCheckoutInput({
      lines,
      customerName,
      customerPhone,
      fulfillmentType: effectiveFulfillment,
      address,
      paymentMethod,
      notes,
    });

    const parsed = checkoutInputSchema.safeParse(input);

    if (!parsed.success) {
      setFieldErrors(zodFieldErrors(parsed.error));
      setError("Revise os campos destacados antes de continuar.");
      return;
    }

    setDraft(parsed.data as CheckoutInput);
    setFieldErrors({});
    setError(null);
    onStep("review");
  }

  async function confirmOrder() {
    if (!draft || submitting || !canReview) {
      return;
    }

    const currentAttempt = attempt ?? {
      idempotencyKey: createIdempotencyKey(),
      trackingToken: createTrackingToken(),
    };

    if (!attempt) {
      onCreateAttempt(currentAttempt);
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await createOrderAction({
        storeSlug: store.slug,
        checkout: draft,
        idempotencyKey: currentAttempt.idempotencyKey,
        trackingToken: currentAttempt.trackingToken,
      });

      if (!result.ok) {
        setError(result.message);

        if (result.fieldErrors) {
          setFieldErrors(result.fieldErrors);
          onStep("checkout");
        }

        return;
      }

      const confirmedTotals = cartTotals(lines, draft.fulfillmentType, store);

      onConfirmed({
        order: result.order,
        lines: [...lines],
        subtotalCents: confirmedTotals.subtotalCents,
        deliveryFeeCents: confirmedTotals.deliveryFeeCents,
        totalCents: result.order.totalCents,
        fulfillmentType: draft.fulfillmentType,
        paymentMethod: draft.paymentMethod,
        address: draft.address,
        trackingToken: currentAttempt.trackingToken,
      });
      onStep("done");
    } catch {
      setError("Não foi possível enviar o pedido. Verifique sua conexão e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  const nameError = errorFor(fieldErrors, "customerName");
  const phoneError = errorFor(fieldErrors, "customerPhone");
  const itemsError = errorFor(fieldErrors, "items");

  return (
    <div
      className={open ? "fixed inset-0 z-50" : "hidden"}
      role="dialog"
      aria-modal="true"
      aria-label="Carrinho e checkout"
    >
      <button
        type="button"
        aria-label="Fechar carrinho"
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-zinc-900/40 backdrop-blur-[1px]"
      />

      <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.15em] text-zinc-400 uppercase">
              {store.name}
            </p>
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
              {STEP_TITLES[step]}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full border border-zinc-200 text-lg leading-none text-zinc-600 hover:bg-zinc-50"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {notice ? (
            <Alert variant="warning" className="mb-4">
              {notice}
            </Alert>
          ) : null}

          {!store.acceptingOrders ? (
            <Alert variant="warning" className="mb-4" title="Pedidos pausados">
              A loja não está aceitando novos pedidos agora. Você pode montar o carrinho, mas a
              finalização está temporariamente indisponível.
            </Alert>
          ) : null}

          {step === "cart" ? (
            <div className="space-y-4">
              {lines.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-10 text-center">
                  <p className="text-sm font-medium text-zinc-700">Seu carrinho está vazio</p>
                  <p className="mt-1 text-sm text-zinc-500">
                    Escolha um produto do cardápio para começar.
                  </p>
                  <Button type="button" variant="secondary" onClick={onClose} className="mt-4">
                    Ver cardápio
                  </Button>
                </div>
              ) : (
                <>
                  <ul className="space-y-3">
                    {lines.map((line) => (
                      <li
                        key={line.key}
                        className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-zinc-900">
                              {line.productName}
                            </p>
                            {line.options.length > 0 ? (
                              <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                                {line.options.map((option) => option.name).join(", ")}
                              </p>
                            ) : null}
                            {line.notes ? (
                              <p className="mt-1 text-xs text-zinc-500 italic">“{line.notes}”</p>
                            ) : null}
                            <p className="mt-1 text-xs text-zinc-500">
                              {formatCurrency(cartLineUnitPriceCents(line))} por unidade
                            </p>
                          </div>
                          <span className="text-sm font-semibold whitespace-nowrap text-zinc-900">
                            {formatCurrency(cartLineTotal(line))}
                          </span>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-2">
                          <div className="flex items-center rounded-lg border border-zinc-300 bg-white">
                            <button
                              type="button"
                              aria-label={`Diminuir quantidade de ${line.productName}`}
                              disabled={line.quantity <= 1}
                              onClick={() => onUpdateQuantity(line.key, line.quantity - 1)}
                              className="px-3 py-1.5 text-base font-semibold text-zinc-600 disabled:opacity-40"
                            >
                              −
                            </button>
                            <span className="min-w-8 text-center text-sm font-semibold text-zinc-900">
                              {line.quantity}
                            </span>
                            <button
                              type="button"
                              aria-label={`Aumentar quantidade de ${line.productName}`}
                              disabled={line.quantity >= MAX_ITEM_QUANTITY}
                              onClick={() => onUpdateQuantity(line.key, line.quantity + 1)}
                              className="px-3 py-1.5 text-base font-semibold text-zinc-600 disabled:opacity-40"
                            >
                              +
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => onRemove(line.key)}
                            className="text-xs font-medium text-red-600 hover:text-red-700"
                          >
                            Remover
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    onClick={onClear}
                    className="text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline"
                  >
                    Limpar carrinho
                  </button>
                </>
              )}
            </div>
          ) : null}

          {step === "checkout" ? (
            <form
              className="space-y-6"
              onSubmit={(event) => {
                event.preventDefault();
                reviewOrder();
              }}
            >
              {error ? <Alert variant="error">{error}</Alert> : null}

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-zinc-900">Seus dados</h3>

                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-zinc-700">Nome</span>
                  <input
                    value={customerName}
                    onChange={(event) => setCustomerName(event.target.value)}
                    maxLength={120}
                    autoComplete="name"
                    aria-invalid={Boolean(nameError)}
                    placeholder="Como devemos chamar você?"
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
                  />
                  {nameError ? (
                    <span className="text-xs font-medium text-red-600">{nameError}</span>
                  ) : null}
                </label>

                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-zinc-700">WhatsApp / telefone</span>
                  <input
                    value={customerPhone}
                    onChange={(event) => setCustomerPhone(event.target.value)}
                    inputMode="tel"
                    maxLength={30}
                    autoComplete="tel"
                    aria-invalid={Boolean(phoneError)}
                    placeholder="(11) 90000-0000"
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
                  />
                  {phoneError ? (
                    <span className="text-xs font-medium text-red-600">{phoneError}</span>
                  ) : null}
                </label>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-zinc-900">Entrega ou retirada</h3>

                <div className="grid gap-2 sm:grid-cols-2">
                  {deliveryAvailable ? (
                    <label
                      className={cn(
                        "cursor-pointer rounded-lg border p-3 text-sm",
                        fulfillmentType === "delivery"
                          ? "border-orange-300 bg-orange-50"
                          : "border-zinc-200 bg-white",
                      )}
                    >
                      <span className="flex items-center gap-2 font-medium text-zinc-900">
                        <input
                          type="radio"
                          name="fulfillment"
                          value="delivery"
                          checked={fulfillmentType === "delivery"}
                          onChange={() => setFulfillmentType("delivery")}
                          className="h-4 w-4 text-orange-600 focus:ring-orange-500"
                        />
                        Entrega
                      </span>
                      <span className="mt-1 block text-xs text-zinc-500">
                        {store.deliveryFeeCents > 0
                          ? `Taxa de ${formatCurrency(store.deliveryFeeCents)}`
                          : "Sem taxa de entrega"}
                      </span>
                    </label>
                  ) : null}

                  {pickupAvailable ? (
                    <label
                      className={cn(
                        "cursor-pointer rounded-lg border p-3 text-sm",
                        fulfillmentType === "pickup"
                          ? "border-orange-300 bg-orange-50"
                          : "border-zinc-200 bg-white",
                      )}
                    >
                      <span className="flex items-center gap-2 font-medium text-zinc-900">
                        <input
                          type="radio"
                          name="fulfillment"
                          value="pickup"
                          checked={fulfillmentType === "pickup"}
                          onChange={() => setFulfillmentType("pickup")}
                          className="h-4 w-4 text-orange-600 focus:ring-orange-500"
                        />
                        Retirada no local
                      </span>
                      <span className="mt-1 block text-xs text-zinc-500">
                        Retire no balcão da loja
                      </span>
                    </label>
                  ) : null}
                </div>
              </section>

              {fulfillmentType === "delivery" && deliveryAvailable ? (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-zinc-900">Endereço de entrega</h3>

                  <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-zinc-700">Rua</span>
                      <input
                        value={address.street}
                        onChange={(event) => setAddressField("street", event.target.value)}
                        autoComplete="address-line1"
                        maxLength={160}
                        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-zinc-700">Número</span>
                      <input
                        value={address.number}
                        onChange={(event) => setAddressField("number", event.target.value)}
                        maxLength={30}
                        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
                      />
                    </label>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-zinc-700">Complemento</span>
                      <input
                        value={address.complement}
                        onChange={(event) => setAddressField("complement", event.target.value)}
                        autoComplete="address-line2"
                        maxLength={120}
                        placeholder="Apto, bloco, casa..."
                        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-zinc-700">Bairro</span>
                      <input
                        value={address.district}
                        onChange={(event) => setAddressField("district", event.target.value)}
                        maxLength={120}
                        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
                      />
                    </label>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-zinc-700">Cidade</span>
                      <input
                        value={address.city}
                        onChange={(event) => setAddressField("city", event.target.value)}
                        autoComplete="address-level2"
                        maxLength={120}
                        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium text-zinc-700">CEP</span>
                      <input
                        value={address.postalCode}
                        onChange={(event) => setAddressField("postalCode", event.target.value)}
                        autoComplete="postal-code"
                        maxLength={20}
                        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
                      />
                    </label>
                  </div>

                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium text-zinc-700">Ponto de referência</span>
                    <input
                      value={address.reference}
                      onChange={(event) => setAddressField("reference", event.target.value)}
                      maxLength={200}
                      placeholder="Ex.: próximo ao mercado"
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
                    />
                  </label>

                  {errorFor(fieldErrors, "address") ? (
                    <p className="text-xs font-medium text-red-600">
                      {errorFor(fieldErrors, "address")}
                    </p>
                  ) : null}
                </section>
              ) : null}

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-zinc-900">Forma de pagamento</h3>

                <div className="space-y-2">
                  {paymentOptions.map((option) => (
                    <label
                      key={option.value}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm",
                        paymentMethod === option.value
                          ? "border-orange-300 bg-orange-50"
                          : "border-zinc-200 bg-white",
                      )}
                    >
                      <input
                        type="radio"
                        name="payment"
                        value={option.value}
                        checked={paymentMethod === option.value}
                        onChange={() => setPaymentMethod(option.value)}
                        className="mt-0.5 h-4 w-4 text-orange-600 focus:ring-orange-500"
                      />
                      <span>
                        <span className="block font-medium text-zinc-900">{option.label}</span>
                        <span className="block text-xs text-zinc-500">{option.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>

                {paymentMethod === "pix" && store.pixKey ? (
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                    <p>
                      Chave Pix: <span className="font-medium text-zinc-800">{store.pixKey}</span>
                    </p>
                    {store.pixReceiverName ? <p>Recebedor: {store.pixReceiverName}</p> : null}
                    <p className="mt-1">
                      O pagamento é conferido manualmente pelo estabelecimento. Nada é cobrado
                      automaticamente.
                    </p>
                  </div>
                ) : null}
              </section>

              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-zinc-900">Observações do pedido</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  maxLength={MAX_ORDER_NOTES}
                  rows={3}
                  placeholder="Ex.: entregar no portão, troco para R$ 100..."
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
                />
              </label>

              {itemsError ? <p className="text-xs font-medium text-red-600">{itemsError}</p> : null}
            </form>
          ) : null}

          {step === "review" && draft ? (
            <div className="space-y-5">
              {error ? <Alert variant="error">{error}</Alert> : null}

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-zinc-900">Itens</h3>
                <ul className="space-y-2">
                  {lines.map((line) => (
                    <li
                      key={line.key}
                      className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-2 text-sm">
                        <span className="font-medium text-zinc-800">
                          {line.quantity}x {line.productName}
                        </span>
                        <span className="whitespace-nowrap text-zinc-700">
                          {formatCurrency(cartLineTotal(line))}
                        </span>
                      </div>
                      {line.options.length > 0 ? (
                        <p className="mt-0.5 text-xs text-zinc-500">
                          {line.options.map((option) => option.name).join(", ")}
                        </p>
                      ) : null}
                      {line.notes ? (
                        <p className="mt-0.5 text-xs text-zinc-500 italic">“{line.notes}”</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="space-y-1 rounded-lg border border-zinc-200 p-3 text-sm">
                <h3 className="font-semibold text-zinc-900">Entrega e pagamento</h3>
                <p className="text-zinc-600">
                  {draft.customerName} · {draft.customerPhone}
                </p>
                <p className="text-zinc-600">
                  {FULFILLMENT_LABELS[draft.fulfillmentType]}
                  {draft.fulfillmentType === "delivery" && draft.address
                    ? ` · ${draft.address.street}, ${draft.address.number}${
                        draft.address.complement ? ` — ${draft.address.complement}` : ""
                      } · ${draft.address.district}, ${draft.address.city}`
                    : ""}
                </p>
                {draft.fulfillmentType === "delivery" &&
                (draft.address?.reference || draft.address?.postalCode) ? (
                  <p className="text-xs text-zinc-500">
                    {draft.address?.reference ? `Referência: ${draft.address.reference}` : ""}
                    {draft.address?.postalCode ? ` · CEP ${draft.address.postalCode}` : ""}
                  </p>
                ) : null}
                <p className="text-zinc-600">{PAYMENT_METHOD_LABELS[draft.paymentMethod]}</p>
                {draft.paymentMethod === "pix" && store.pixKey ? (
                  <p className="text-xs text-zinc-500">
                    Chave Pix: {store.pixKey}
                    {store.pixReceiverName ? ` · ${store.pixReceiverName}` : ""}
                  </p>
                ) : null}
                {draft.notes ? (
                  <p className="text-xs text-zinc-500 italic">“{draft.notes}”</p>
                ) : null}
              </section>

              <section className="space-y-1 border-t border-zinc-200 pt-3 text-sm">
                <div className="flex justify-between text-zinc-600">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotalCents)}</span>
                </div>
                <div className="flex justify-between text-zinc-600">
                  <span>Taxa de entrega</span>
                  <span>
                    {draft.fulfillmentType === "delivery" && store.deliveryFeeCents > 0
                      ? formatCurrency(store.deliveryFeeCents)
                      : "Grátis"}
                  </span>
                </div>
                <div className="flex justify-between pt-1 text-base font-semibold text-zinc-900">
                  <span>Total</span>
                  <span>
                    {formatCurrency(
                      subtotalCents +
                        (draft.fulfillmentType === "delivery" ? store.deliveryFeeCents : 0),
                    )}
                  </span>
                </div>
              </section>

              <p className="text-xs leading-relaxed text-zinc-500">
                Ao confirmar, o pedido é registrado no estabelecimento. O pagamento não é cobrado
                online e será conferido pela loja.
              </p>
            </div>
          ) : null}

          {step === "done" && confirmation ? (
            <div className="space-y-5">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-sm font-semibold text-emerald-900">
                  Pedido #{confirmation.order.orderNumber} confirmado!
                </p>
                <p className="mt-1 text-sm text-emerald-800">
                  O estabelecimento recebeu seu pedido e vai confirmar em instantes.
                </p>
                <div className="mt-2">
                  <StatusBadge status={confirmation.order.status} />
                </div>
              </div>

              <section className="space-y-1 text-sm">
                <div className="flex justify-between text-zinc-600">
                  <span>Subtotal</span>
                  <span>{formatCurrency(confirmation.subtotalCents)}</span>
                </div>
                <div className="flex justify-between text-zinc-600">
                  <span>Taxa de entrega</span>
                  <span>
                    {confirmation.deliveryFeeCents > 0
                      ? formatCurrency(confirmation.deliveryFeeCents)
                      : "Grátis"}
                  </span>
                </div>
                <div className="flex justify-between pt-1 text-base font-semibold text-zinc-900">
                  <span>Total</span>
                  <span>{formatCurrency(confirmation.totalCents)}</span>
                </div>
                <p className="pt-1 text-zinc-600">
                  {PAYMENT_METHOD_LABELS[confirmation.paymentMethod]} ·{" "}
                  {FULFILLMENT_LABELS[confirmation.fulfillmentType]}
                </p>
                {confirmation.paymentMethod === "pix" && store.pixKey ? (
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                    <p>
                      Chave Pix: <span className="font-medium text-zinc-800">{store.pixKey}</span>
                    </p>
                    {store.pixReceiverName ? <p>Recebedor: {store.pixReceiverName}</p> : null}
                    <p className="mt-1">
                      O pedido continua como “aguardando pagamento” até a loja conferir o
                      comprovante.
                    </p>
                  </div>
                ) : null}
              </section>

              <div className="space-y-2">
                <a
                  href={trackingUrl(
                    store.slug,
                    confirmation.order.orderNumber,
                    confirmation.trackingToken,
                  )}
                  referrerPolicy="no-referrer"
                  className="block w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-center text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50"
                >
                  Acompanhar pedido
                </a>

                {store.phone ? (
                  <a
                    href={`https://wa.me/${whatsappNumber(store.phone)}?text=${encodeURIComponent(
                      whatsappMessage(store, confirmation),
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                    className="block w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
                  >
                    Falar com a loja no WhatsApp
                  </a>
                ) : null}

                <p className="text-xs leading-relaxed text-zinc-500">
                  Guarde o link de acompanhamento. Ele funciona sem login e não aparece em buscas.
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <footer className="border-t border-zinc-200 bg-white px-4 py-3">
          {step === "cart" ? (
            <div className="space-y-3">
              <div className="space-y-1 text-sm">
                <div className="flex justify-between text-zinc-600">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotalCents)}</span>
                </div>
                {store.acceptingOrders && lines.length > 0 && !totals.meetsMinimum ? (
                  <p className="text-xs font-medium text-amber-700">
                    O pedido mínimo é {formatCurrency(store.minOrderCents)}. Faltam{" "}
                    {formatCurrency(totals.missingForMinimumCents)}.
                  </p>
                ) : null}
              </div>

              <Button
                type="button"
                disabled={!canReview || lines.length === 0}
                onClick={goToCheckout}
                className="w-full"
              >
                Continuar para o checkout
              </Button>
            </div>
          ) : null}

          {step === "checkout" ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onStep("cart")}
                className="flex-1"
              >
                Voltar
              </Button>
              <Button type="button" disabled={!canReview} onClick={reviewOrder} className="flex-1">
                Revisar pedido
              </Button>
            </div>
          ) : null}

          {step === "review" ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onStep("checkout")}
                disabled={submitting}
                className="flex-1"
              >
                Editar
              </Button>
              <Button
                type="button"
                onClick={confirmOrder}
                disabled={submitting || !canReview}
                className="flex-1"
              >
                {submitting ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    Enviando...
                  </>
                ) : (
                  "Confirmar pedido"
                )}
              </Button>
            </div>
          ) : null}

          {step === "done" ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                onClear();
                onClose();
              }}
              className="w-full"
            >
              Fazer novo pedido
            </Button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
