"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn, formatCurrency, formatDateTime } from "@/lib/utils";
import { DELIVERY_STATUS_LABELS, isActiveDeliveryStatus } from "@/modules/deliveries/constants";
import {
  completeDeliveryAction,
  refreshDriverDeliveriesAction,
  startDeliveryAction,
} from "@/modules/deliveries/actions";
import type { DriverDelivery } from "@/modules/deliveries/types";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
} from "@/modules/orders/constants";
import type { DeliveryStatus } from "@/types/database";

const DELIVERY_VARIANTS: Record<DeliveryStatus, BadgeVariant> = {
  assigned: "warning",
  picked_up: "brand",
  delivered: "success",
  canceled: "muted",
};

function addressLine(delivery: DriverDelivery): string {
  const address = delivery.order.deliveryAddress;

  if (!address) {
    return "";
  }

  return [
    `${address.street}, ${address.number}`,
    address.complement,
    address.district,
    address.city,
    address.postalCode ? `CEP ${address.postalCode}` : "",
  ]
    .filter(Boolean)
    .join(" — ");
}

function mapsUrl(delivery: DriverDelivery): string | null {
  const line = addressLine(delivery);
  return line
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(line)}`
    : null;
}

function DeliveryCard({
  item,
  pending,
  onStart,
  onComplete,
}: {
  item: DriverDelivery;
  pending: boolean;
  onStart: (id: string) => void;
  onComplete: (id: string) => void;
}) {
  const { delivery, order } = item;
  const active = isActiveDeliveryStatus(delivery.status);
  const canStart =
    delivery.status === "assigned" &&
    (order.status === "ready" || order.status === "out_for_delivery");
  const canComplete = delivery.status === "picked_up";
  const line = addressLine(item);
  const map = mapsUrl(item);

  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-lg font-semibold text-zinc-900">Pedido #{order.orderNumber}</p>
          <p className="text-xs text-zinc-500">
            Atribuído em {formatDateTime(delivery.assignedAt)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={DELIVERY_VARIANTS[delivery.status]}>
            {DELIVERY_STATUS_LABELS[delivery.status]}
          </Badge>
          <span className="text-xs text-zinc-500">{ORDER_STATUS_LABELS[order.status]}</span>
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-zinc-50 p-3">
        <p className="text-sm font-medium text-zinc-900">{order.customerName}</p>
        <a
          href={`tel:${order.customerPhone.replace(/[^0-9+]/g, "")}`}
          className="text-sm font-medium text-orange-700"
        >
          {order.customerPhone}
        </a>
        {line ? <p className="mt-1 text-sm text-zinc-600">{line}</p> : null}
        {order.deliveryAddress?.reference ? (
          <p className="text-xs text-zinc-500">Referência: {order.deliveryAddress.reference}</p>
        ) : null}
        {map ? (
          <a
            href={map}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex text-sm font-semibold text-orange-700 hover:text-orange-800"
          >
            Abrir endereço no mapa
          </a>
        ) : null}
      </div>

      <ul className="mt-3 divide-y divide-zinc-100">
        {order.items.map((item) => (
          <li key={item.id} className="py-2 text-sm">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-zinc-800">
                {item.quantity}x {item.productName}
              </span>
              <span className="whitespace-nowrap text-zinc-700">
                {formatCurrency(item.totalCents)}
              </span>
            </div>
            {item.options.length > 0 ? (
              <p className="text-xs text-zinc-500">
                {item.options
                  .map((option) =>
                    option.quantity > 1 ? `${option.name} ×${option.quantity}` : option.name,
                  )
                  .join(", ")}
              </p>
            ) : null}
            {item.notes ? <p className="text-xs text-zinc-500 italic">“{item.notes}”</p> : null}
          </li>
        ))}
      </ul>

      {order.notes ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {order.notes}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3">
        <div className="text-sm">
          <p className="font-semibold text-zinc-900">{formatCurrency(order.totalCents)}</p>
          <p className="text-xs text-zinc-500">
            {PAYMENT_METHOD_LABELS[order.paymentMethod]} ·{" "}
            {PAYMENT_STATUS_LABELS[order.paymentStatus]}
          </p>
        </div>

        {active ? (
          <div className="flex flex-wrap gap-2">
            {canStart ? (
              <Button type="button" disabled={pending} onClick={() => onStart(delivery.id)}>
                Iniciar entrega
              </Button>
            ) : null}
            {canComplete ? (
              <Button type="button" disabled={pending} onClick={() => onComplete(delivery.id)}>
                Confirmar entrega
              </Button>
            ) : null}
            {delivery.status === "assigned" && !canStart ? (
              <span className="text-xs text-zinc-500">Aguardando o pedido ficar pronto.</span>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">
            {delivery.status === "delivered" && delivery.deliveredAt
              ? `Entregue em ${formatDateTime(delivery.deliveredAt)}`
              : delivery.cancelReason
                ? `Cancelada: ${delivery.cancelReason}`
                : "Entrega encerrada"}
          </p>
        )}
      </div>
    </article>
  );
}

export function DriverPanel({
  storeId,
  storeName,
  driverName,
  initialDeliveries,
}: {
  storeId: string;
  storeName: string;
  driverName: string;
  initialDeliveries: DriverDelivery[];
}) {
  const [deliveries, setDeliveries] = useState(initialDeliveries);
  const [tab, setTab] = useState<"active" | "history">("active");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(
    async (silent = false) => {
      if (!silent) {
        setRefreshing(true);
      }

      try {
        const result = await refreshDriverDeliveriesAction(storeId);

        if (result.ok) {
          setDeliveries(result.deliveries);
          setLastSync(new Date());
        } else if (!silent) {
          setError(result.message);
        }
      } catch {
        if (!silent) {
          setError("Não foi possível atualizar suas entregas.");
        }
      } finally {
        if (!silent) {
          setRefreshing(false);
        }
      }
    },
    [storeId],
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh(true);
      }
    }, 20_000);

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

  function run(action: () => Promise<{ status: string; message?: string }>) {
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const result = await action();

      if (result.status === "error") {
        setError(result.message ?? "Não foi possível concluir a ação.");
        return;
      }

      setMessage(result.message ?? "Ação concluída.");
      await refresh(true);
    });
  }

  const activeDeliveries = deliveries.filter((item) =>
    isActiveDeliveryStatus(item.delivery.status),
  );
  const historyDeliveries = deliveries.filter(
    (item) => !isActiveDeliveryStatus(item.delivery.status),
  );
  const visible = tab === "active" ? activeDeliveries : historyDeliveries;

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{storeName}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Minhas entregas</h1>
        <p className="text-sm text-zinc-500">
          Olá, {driverName}. {activeDeliveries.length} em andamento · {historyDeliveries.length} no
          histórico.
        </p>
      </header>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {message ? <Alert variant="success">{message}</Alert> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-1 shadow-sm">
          {(
            [
              ["active", `Em andamento (${activeDeliveries.length})`],
              ["history", `Histórico (${historyDeliveries.length})`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                tab === value ? "bg-orange-600 text-white" : "text-zinc-600 hover:bg-zinc-50",
              )}
            >
              {label}
            </button>
          ))}
        </div>

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

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-4 py-12 text-center">
          <p className="text-sm font-medium text-zinc-700">
            {tab === "active" ? "Nenhuma entrega atribuída" : "Nenhuma entrega no histórico"}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {tab === "active"
              ? "Quando a loja atribuir um pedido a você, ele aparece aqui."
              : "Entregas concluídas e canceladas ficam registradas aqui."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((item) => (
            <DeliveryCard
              key={item.delivery.id}
              item={item}
              pending={pending}
              onStart={(id) => run(() => startDeliveryAction(id))}
              onComplete={(id) => {
                if (window.confirm("Confirmar a entrega deste pedido?")) {
                  run(() => completeDeliveryAction(id));
                }
              }}
            />
          ))}
        </div>
      )}

      <p className="pb-6 text-xs text-zinc-500">
        {lastSync ? `Atualizado às ${formatDateTime(lastSync)}. ` : ""}A tela atualiza
        automaticamente a cada 20 segundos. O banco de dados é a fonte de verdade.
      </p>
    </div>
  );
}
