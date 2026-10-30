"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn, formatCurrency, formatDateTime } from "@/lib/utils";
import {
  FULFILLMENT_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  ORDER_STATUS_SHORT_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
} from "@/modules/orders/constants";
import {
  getOrderDetailAction,
  refreshOrdersAction,
  updateOrderPaymentAction,
  updateOrderStatusAction,
} from "@/modules/orders/actions";
import { allowedNextStatuses, isTerminalStatus } from "@/modules/orders/status";
import type { OrderDetail, OrderSummary } from "@/modules/orders/types";
import type { OrderPaymentStatus, OrderStatus } from "@/types/database";

const STATUS_VARIANTS: Record<OrderStatus, BadgeVariant> = {
  pending: "warning",
  accepted: "brand",
  preparing: "brand",
  ready: "success",
  out_for_delivery: "brand",
  delivered: "success",
  canceled: "muted",
};

const PAYMENT_VARIANTS: Record<OrderPaymentStatus, BadgeVariant> = {
  pending: "warning",
  paid: "success",
  canceled: "muted",
};

const NEXT_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Reabrir como novo",
  accepted: "Aceitar pedido",
  preparing: "Iniciar preparo",
  ready: "Marcar como pronto",
  out_for_delivery: "Saiu para entrega",
  delivered: "Marcar como entregue",
  canceled: "Cancelar pedido",
};

type OrderFilter = "active" | "all" | OrderStatus;

const FILTER_OPTIONS: { value: OrderFilter; label: string }[] = [
  { value: "active", label: "Em andamento" },
  { value: "all", label: "Todos os pedidos" },
  ...ORDER_STATUSES.map((status) => ({
    value: status,
    label: ORDER_STATUS_LABELS[status],
  })),
];

function matchesFilter(order: OrderSummary, filter: OrderFilter): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "active") {
    return !isTerminalStatus(order.status);
  }

  return order.status === filter;
}

function matchesSearch(order: OrderSummary, term: string): boolean {
  if (!term) {
    return true;
  }

  const digits = term.replace(/[^0-9]/g, "");

  return (
    String(order.orderNumber).includes(term) ||
    order.customerName.toLowerCase().includes(term.toLowerCase()) ||
    (digits.length > 0 && order.customerPhone.includes(digits))
  );
}

function orderSubtitle(order: OrderSummary): string {
  const itemCount = order.items.reduce((total, item) => total + item.quantity, 0);
  return `${itemCount} ${itemCount === 1 ? "item" : "itens"} · ${FULFILLMENT_LABELS[order.fulfillmentType]}`;
}

function StatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{ORDER_STATUS_SHORT_LABELS[status]}</Badge>;
}

function paymentActions(
  status: OrderPaymentStatus,
): { value: OrderPaymentStatus; label: string }[] {
  switch (status) {
    case "pending":
      return [
        { value: "paid", label: "Marcar como pago" },
        { value: "canceled", label: "Cancelar pagamento" },
      ];
    case "paid":
      return [{ value: "pending", label: "Reabrir pagamento" }];
    case "canceled":
      return [{ value: "pending", label: "Reabrir pagamento" }];
  }
}

function OrderDetailPanel({
  order,
  detail,
  loadingDetail,
  pending,
  canCancel,
  canManagePayments,
  onStatus,
  onPayment,
}: {
  order: OrderSummary;
  detail: OrderDetail | null;
  loadingDetail: boolean;
  pending: boolean;
  canCancel: boolean;
  canManagePayments: boolean;
  onStatus: (status: OrderStatus) => void;
  onPayment: (status: OrderPaymentStatus) => void;
}) {
  const nextStatuses = allowedNextStatuses(order.status, order.fulfillmentType).filter(
    (status) => status !== "canceled" || canCancel,
  );

  const events = detail?.events ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
              Pedido #{order.orderNumber}
            </h2>
            <StatusBadge status={order.status} />
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Recebido em {formatDateTime(order.createdAt)} · {orderSubtitle(order)}
          </p>
        </div>

        <div className="text-right">
          <p className="text-xs text-zinc-500">Total</p>
          <p className="text-xl font-semibold text-zinc-900">{formatCurrency(order.totalCents)}</p>
        </div>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <h3 className="text-sm font-semibold text-zinc-900">Cliente</h3>
        <p className="mt-1 text-sm font-medium text-zinc-800">{order.customerName}</p>
        <a
          href={`tel:${order.customerPhone.replace(/[^0-9+]/g, "")}`}
          className="text-sm text-orange-700 hover:text-orange-800"
        >
          {order.customerPhone}
        </a>

        <div className="mt-2 text-sm text-zinc-600">
          <p className="font-medium text-zinc-800">
            {FULFILLMENT_LABELS[order.fulfillmentType]}
            {order.fulfillmentType === "pickup" ? " no local" : ""}
          </p>
          {order.fulfillmentType === "delivery" && order.deliveryAddress ? (
            <div className="mt-0.5 space-y-0.5">
              <p>
                {order.deliveryAddress.street}, {order.deliveryAddress.number}
                {order.deliveryAddress.complement ? ` — ${order.deliveryAddress.complement}` : ""}
              </p>
              <p>
                {order.deliveryAddress.district} · {order.deliveryAddress.city}
              </p>
              {order.deliveryAddress.reference ? (
                <p className="text-xs">Referência: {order.deliveryAddress.reference}</p>
              ) : null}
              {order.deliveryAddress.postalCode ? (
                <p className="text-xs">CEP {order.deliveryAddress.postalCode}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-zinc-900">Itens</h3>
        <ul className="mt-2 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
          {order.items.map((item) => (
            <li key={item.id} className="px-3 py-2.5">
              <div className="flex items-start justify-between gap-3 text-sm">
                <span className="font-medium text-zinc-800">
                  {item.quantity}x {item.productName}
                </span>
                <span className="whitespace-nowrap text-zinc-800">
                  {formatCurrency(item.totalCents)}
                </span>
              </div>
              {item.options.length > 0 ? (
                <p className="mt-0.5 text-xs text-zinc-500">
                  {item.options
                    .map((option) =>
                      option.quantity > 1 ? `${option.name} ×${option.quantity}` : option.name,
                    )
                    .join(", ")}
                </p>
              ) : null}
              {item.notes ? (
                <p className="mt-0.5 text-xs text-zinc-500 italic">“{item.notes}”</p>
              ) : null}
            </li>
          ))}
        </ul>

        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between text-zinc-600">
            <dt>Subtotal</dt>
            <dd>{formatCurrency(order.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between text-zinc-600">
            <dt>Taxa de entrega</dt>
            <dd>
              {order.deliveryFeeCents > 0 ? formatCurrency(order.deliveryFeeCents) : "Grátis"}
            </dd>
          </div>
          <div className="flex justify-between border-t border-zinc-100 pt-1 text-base font-semibold text-zinc-900">
            <dt>Total</dt>
            <dd>{formatCurrency(order.totalCents)}</dd>
          </div>
        </dl>
      </section>

      {order.notes ? (
        <section>
          <h3 className="text-sm font-semibold text-zinc-900">Observações do pedido</h3>
          <p className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {order.notes}
          </p>
        </section>
      ) : null}

      <section className="rounded-lg border border-zinc-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-900">Pagamento</h3>
          <Badge variant={PAYMENT_VARIANTS[order.paymentStatus]}>
            {PAYMENT_STATUS_LABELS[order.paymentStatus]}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-zinc-600">{PAYMENT_METHOD_LABELS[order.paymentMethod]}</p>
        {order.paymentMethod === "pix" ? (
          <p className="mt-1 text-xs text-zinc-500">
            Pix manual: confira o comprovante antes de marcar como pago.
          </p>
        ) : null}

        {canManagePayments ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {paymentActions(order.paymentStatus).map((action) => (
              <Button
                key={action.value}
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => onPayment(action.value)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-xs text-zinc-500">
            Apenas proprietários e gerentes alteram o pagamento.
          </p>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-zinc-900">Andamento</h3>

        {nextStatuses.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-500">
            {order.status === "delivered"
              ? "Pedido entregue. Os dados ficam preservados como histórico."
              : "Pedido cancelado. Nenhuma outra mudança de andamento é permitida."}
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {nextStatuses.map((status) => (
              <Button
                key={status}
                type="button"
                variant={status === "canceled" ? "danger" : "primary"}
                disabled={pending}
                onClick={() => onStatus(status)}
              >
                {NEXT_STATUS_LABELS[status]}
              </Button>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-zinc-900">Histórico de status</h3>

        {loadingDetail && events.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-500">Carregando histórico...</p>
        ) : events.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-500">Nenhum evento registrado.</p>
        ) : (
          <ol className="mt-2 space-y-1.5 border-l border-zinc-200 pl-3">
            {events.map((event, index) => (
              <li
                key={`${event.status}-${event.createdAt}-${index}`}
                className="text-xs text-zinc-500"
              >
                <span className="font-medium text-zinc-700">
                  {ORDER_STATUS_LABELS[event.status]}
                </span>{" "}
                · {formatDateTime(event.createdAt)}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

export function OrdersBoard({
  storeName,
  initialOrders,
  canCancel,
  canManagePayments,
}: {
  storeName: string;
  initialOrders: OrderSummary[];
  canCancel: boolean;
  canManagePayments: boolean;
}) {
  const [orders, setOrders] = useState<OrderSummary[]>(initialOrders);
  const [filter, setFilter] = useState<OrderFilter>("active");
  const [search, setSearch] = useState("");
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailErrorId, setDetailErrorId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncTick, setSyncTick] = useState(0);
  const [pending, startTransition] = useTransition();

  const filteredOrders = useMemo(
    () =>
      orders.filter((order) => matchesFilter(order, filter) && matchesSearch(order, search.trim())),
    [orders, filter, search],
  );

  const counts = useMemo(() => {
    const base: Record<OrderStatus, number> = {
      pending: 0,
      accepted: 0,
      preparing: 0,
      ready: 0,
      out_for_delivery: 0,
      delivered: 0,
      canceled: 0,
    };

    for (const order of orders) {
      base[order.status] += 1;
    }

    return base;
  }, [orders]);

  const selectedId =
    requestedId && filteredOrders.some((order) => order.id === requestedId)
      ? requestedId
      : (filteredOrders[0]?.id ?? null);
  const loadingDetail =
    selectedId !== null && detail?.id !== selectedId && detailErrorId !== selectedId;

  const selectedOrder = orders.find((order) => order.id === selectedId) ?? null;

  const refresh = useCallback(async (silent = false) => {
    if (!silent) {
      setRefreshing(true);
    }

    try {
      const result = await refreshOrdersAction();

      if (result.ok) {
        setOrders(result.orders);
        setSyncError(null);
        setLastSync(new Date());
        setSyncTick((value) => value + 1);
      } else if (!silent) {
        setSyncError(result.message);
      }
    } catch {
      if (!silent) {
        setSyncError("Não foi possível atualizar os pedidos agora.");
      }
    } finally {
      if (!silent) {
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh(true);
      }
    }, 15_000);

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        void refresh(true);
      }
    }

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    let cancelled = false;

    getOrderDetailAction(selectedId)
      .then((result) => {
        if (cancelled) {
          return;
        }

        if (result.ok) {
          setDetail(result.order);
          setDetailErrorId(null);
        } else {
          setDetailErrorId(selectedId);
          setActionError(result.message);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetailErrorId(selectedId);
          setActionError("Não foi possível carregar os detalhes do pedido.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId, syncTick]);

  function handleStatus(next: OrderStatus) {
    if (!selectedOrder) {
      return;
    }

    if (
      next === "canceled" &&
      !window.confirm("Cancelar este pedido? Esta ação não pode ser desfeita.")
    ) {
      return;
    }

    setActionError(null);
    setActionMessage(null);

    startTransition(async () => {
      const result = await updateOrderStatusAction(selectedOrder.id, next);

      if (result.status === "error") {
        setActionError(result.message ?? "Não foi possível atualizar o pedido.");
        return;
      }

      setActionMessage(result.message ?? "Status atualizado.");
      await refresh(true);
    });
  }

  function handlePayment(next: OrderPaymentStatus) {
    if (!selectedOrder) {
      return;
    }

    setActionError(null);
    setActionMessage(null);

    startTransition(async () => {
      const result = await updateOrderPaymentAction(selectedOrder.id, next);

      if (result.status === "error") {
        setActionError(result.message ?? "Não foi possível atualizar o pagamento.");
        return;
      }

      setActionMessage(result.message ?? "Pagamento atualizado.");
      await refresh(true);
    });
  }

  const activeCount = orders.filter((order) => !isTerminalStatus(order.status)).length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Pedidos</h1>
          <p className="text-sm text-zinc-500">
            {storeName} · {activeCount} em andamento · {counts.pending} aguardando aceite
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
              syncError
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-700",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {syncError ? "Atualização com falha" : "Atualização automática"}
          </span>

          <Button
            type="button"
            variant="secondary"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            {refreshing ? (
              <>
                <Spinner className="h-4 w-4" />
                Atualizando...
              </>
            ) : (
              "Atualizar"
            )}
          </Button>
        </div>
      </header>

      {syncError ? <Alert variant="warning">{syncError}</Alert> : null}
      {actionError ? <Alert variant="error">{actionError}</Alert> : null}
      {actionMessage ? <Alert variant="success">{actionMessage}</Alert> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 gap-2">
          <Select
            aria-label="Filtrar pedidos"
            value={filter}
            onChange={(event) => setFilter(event.target.value as OrderFilter)}
            className="sm:max-w-56"
          >
            {FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>

          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por número, nome ou telefone"
            aria-label="Buscar pedidos"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none"
          />
        </div>

        <p className="text-xs text-zinc-500">
          {lastSync ? `Sincronizado às ${formatDateTime(lastSync)}` : "Aguardando sincronização"}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr] lg:items-start">
        <section className="space-y-2" aria-label="Lista de pedidos">
          {filteredOrders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-10 text-center">
              <p className="text-sm font-medium text-zinc-700">Nenhum pedido neste filtro</p>
              <p className="mt-1 text-sm text-zinc-500">
                Novos pedidos aparecem aqui automaticamente.
              </p>
            </div>
          ) : (
            <ul className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
              {filteredOrders.map((order) => {
                const selected = order.id === selectedId;

                return (
                  <li key={order.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setRequestedId(order.id);
                        setActionError(null);
                        setActionMessage(null);
                      }}
                      className={cn(
                        "w-full rounded-xl border bg-white p-3 text-left shadow-sm transition-colors",
                        selected
                          ? "border-orange-300 ring-2 ring-orange-500/15"
                          : "border-zinc-200 hover:border-zinc-300",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-zinc-900">
                            #{order.orderNumber}
                            <span className="ml-2 text-xs font-normal text-zinc-500">
                              {formatDateTime(order.createdAt)}
                            </span>
                          </p>
                          <p className="mt-0.5 text-sm text-zinc-700">{order.customerName}</p>
                        </div>
                        <StatusBadge status={order.status} />
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-xs text-zinc-500">
                        <span>{orderSubtitle(order)}</span>
                        <span className="font-semibold text-zinc-800">
                          {formatCurrency(order.totalCents)}
                        </span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                        <span>{PAYMENT_METHOD_LABELS[order.paymentMethod]}</span>
                        <span>·</span>
                        <span>{PAYMENT_STATUS_LABELS[order.paymentStatus]}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section
          className="min-h-64 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5"
          aria-label="Detalhes do pedido"
        >
          {selectedOrder ? (
            <OrderDetailPanel
              order={selectedOrder}
              detail={detail?.id === selectedOrder.id ? detail : null}
              loadingDetail={loadingDetail}
              pending={pending}
              canCancel={canCancel}
              canManagePayments={canManagePayments}
              onStatus={handleStatus}
              onPayment={handlePayment}
            />
          ) : (
            <div className="grid h-full min-h-48 place-items-center text-center">
              <p className="text-sm text-zinc-500">
                Selecione um pedido na lista para ver os detalhes.
              </p>
            </div>
          )}
        </section>
      </div>

      <p className="text-xs text-zinc-500">
        A fila é atualizada automaticamente a cada 15 segundos. O banco de dados é a fonte de
        verdade; recarregar a página sempre traz o estado mais recente.
      </p>
    </div>
  );
}
