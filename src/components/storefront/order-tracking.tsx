"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { DELIVERY_STATUS_LABELS } from "@/modules/deliveries/constants";
import {
  FULFILLMENT_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_SHORT_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
} from "@/modules/orders/constants";
import { readTrackingToken } from "@/modules/orders/cart";
import { getOrderTrackingAction } from "@/modules/orders/actions";
import { isTerminalStatus } from "@/modules/orders/status";
import { DELIVERY_MAP_STATE_LABELS, getDeliveryMapState } from "@/modules/tracking/status";
import type { TrackingOrder } from "@/modules/orders/types";
import type { OrderStatus } from "@/types/database";

const DeliveryMap = dynamic(
  () => import("@/components/storefront/delivery-map").then((module) => module.DeliveryMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-60 w-full items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50">
        <p className="text-xs text-zinc-500">Carregando mapa...</p>
      </div>
    ),
  },
);

const DELIVERY_FLOW: OrderStatus[] = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
];

const PICKUP_FLOW: OrderStatus[] = ["pending", "accepted", "preparing", "ready", "delivered"];

const STATUS_CLASSES: Record<OrderStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  accepted: "border-sky-200 bg-sky-50 text-sky-800",
  preparing: "border-sky-200 bg-sky-50 text-sky-800",
  ready: "border-emerald-200 bg-emerald-50 text-emerald-800",
  out_for_delivery: "border-orange-200 bg-orange-50 text-orange-800",
  delivered: "border-emerald-200 bg-emerald-50 text-emerald-800",
  canceled: "border-zinc-200 bg-zinc-100 text-zinc-600",
};

function tokenFromHash(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.location.hash.replace(/^#/, "");

  if (!raw) {
    return null;
  }

  const token = new URLSearchParams(raw).get("t");

  return token && /^[0-9a-f]{64}$/.test(token) ? token : null;
}

export function OrderTracking({
  storeSlug,
  orderNumber,
}: {
  storeSlug: string;
  orderNumber: number;
}) {
  const tokenRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const hasOrder = useRef(false);

  const [order, setOrder] = useState<TrackingOrder | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "invalid">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const token = tokenRef.current;

    if (!token) {
      setMessage("Abra esta página pelo link de acompanhamento enviado na confirmação do pedido.");
      setPhase("invalid");
      return;
    }

    if (inFlight.current) {
      return;
    }

    inFlight.current = true;
    setRefreshing(true);

    try {
      const result = await getOrderTrackingAction({
        storeSlug,
        orderNumber,
        trackingToken: token,
      });

      if (result.ok) {
        setOrder(result.order);
        hasOrder.current = true;
        setPhase("ready");
        setRefreshError(null);
        setCheckedAt(new Date());
        return;
      }

      if (hasOrder.current) {
        setRefreshError(result.message);
      } else {
        setMessage(result.message);
        setPhase("invalid");
      }
    } catch {
      if (hasOrder.current) {
        setRefreshError("Não foi possível atualizar agora. Tentaremos novamente.");
      } else {
        setMessage("Não foi possível consultar o pedido agora. Tente novamente.");
        setPhase("invalid");
      }
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [storeSlug, orderNumber]);

  useEffect(() => {
    tokenRef.current = tokenFromHash() ?? readTrackingToken(storeSlug, orderNumber);
    void load();
  }, [load, storeSlug, orderNumber]);

  useEffect(() => {
    if (phase !== "ready" || !order || isTerminalStatus(order.status)) {
      return;
    }

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load();
      }
    }, 12_000);

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        void load();
      }
    }

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [phase, order, load]);

  if (phase === "loading") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-4 py-24 text-center">
        <Spinner className="h-6 w-6 text-orange-600" />
        <p className="text-sm text-zinc-600">Consultando seu pedido...</p>
      </div>
    );
  }

  if (phase === "invalid" || !order) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-5 px-4 py-16">
        <div className="space-y-1 text-center">
          <p className="text-xs font-semibold tracking-[0.15em] text-zinc-400 uppercase">
            Acompanhamento
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Pedido não encontrado
          </h1>
        </div>

        <Alert variant="warning" title="Link inválido ou incompleto">
          {message ??
            "Não foi possível localizar este pedido. Use o link de acompanhamento exibido após a confirmação."}
        </Alert>

        <div className="flex flex-wrap justify-center gap-2">
          <Link
            href={`/loja/${storeSlug}`}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50"
          >
            Voltar ao cardápio
          </Link>
        </div>
      </div>
    );
  }

  const flow = order.fulfillmentType === "delivery" ? DELIVERY_FLOW : PICKUP_FLOW;
  const currentIndex = flow.indexOf(order.status);
  const canceled = order.status === "canceled";
  const trackingLocation = order.delivery?.location ?? null;
  const mapState = getDeliveryMapState({
    status: order.delivery?.status ?? null,
    hasLocation: Boolean(trackingLocation),
    updatedAt: trackingLocation?.updatedAt ?? null,
  });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-8 sm:py-10">
      <header className="space-y-1">
        <p className="text-xs font-semibold tracking-[0.15em] text-zinc-400 uppercase">
          {order.store.name}
        </p>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Pedido #{order.orderNumber}
          </h1>
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_CLASSES[order.status]}`}
          >
            {ORDER_STATUS_LABELS[order.status]}
          </span>
        </div>
        <p className="text-sm text-zinc-500">
          Feito em {formatDateTime(order.createdAt)} · {FULFILLMENT_LABELS[order.fulfillmentType]}
        </p>
      </header>

      {canceled ? (
        <Alert variant="warning" title="Pedido cancelado">
          Este pedido foi cancelado pelo estabelecimento. Em caso de dúvida, fale diretamente com a
          loja.
        </Alert>
      ) : (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <ol className="flex flex-wrap gap-1.5">
            {flow.map((status, index) => {
              const done = index < currentIndex;
              const current = index === currentIndex;

              return (
                <li
                  key={status}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    current
                      ? "border-orange-300 bg-orange-50 text-orange-800"
                      : done
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-zinc-200 bg-zinc-50 text-zinc-400"
                  }`}
                  aria-current={current ? "step" : undefined}
                >
                  {ORDER_STATUS_SHORT_LABELS[status]}
                </li>
              );
            })}
          </ol>

          <p className="mt-3 text-sm text-zinc-600">
            {order.status === "pending"
              ? "Aguardando a confirmação do estabelecimento."
              : order.status === "accepted"
                ? "Pedido aceito. Em breve o preparo começa."
                : order.status === "preparing"
                  ? "Seu pedido está sendo preparado."
                  : order.status === "ready"
                    ? order.fulfillmentType === "delivery"
                      ? "Pedido pronto. Ele sairá para entrega em breve."
                      : "Pedido pronto para retirada no local."
                    : order.status === "out_for_delivery"
                      ? "O pedido saiu para entrega."
                      : "Pedido entregue. Bom apetite!"}
          </p>
        </section>
      )}

      {!canceled && order.fulfillmentType === "delivery" && order.delivery ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-900">Entrega</h2>
            <Badge variant={order.delivery.status === "picked_up" ? "brand" : "warning"}>
              {DELIVERY_STATUS_LABELS[order.delivery.status]}
            </Badge>
          </div>

          <p className="mt-2 text-sm text-zinc-600">
            {order.delivery.status === "assigned"
              ? "Um entregador foi designado e vai coletar o pedido na loja."
              : order.delivery.status === "picked_up"
                ? "O pedido foi coletado e está a caminho do seu endereço."
                : order.delivery.status === "delivered"
                  ? "Entrega concluída no endereço informado."
                  : "A atribuição anterior foi cancelada. A loja vai designar outro entregador."}
          </p>

          <dl className="mt-3 space-y-1 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
            {order.delivery.assignedAt ? (
              <div className="flex justify-between gap-2">
                <dt>Designado</dt>
                <dd>{formatDateTime(order.delivery.assignedAt)}</dd>
              </div>
            ) : null}
            {order.delivery.pickedUpAt ? (
              <div className="flex justify-between gap-2">
                <dt>Coletado</dt>
                <dd>{formatDateTime(order.delivery.pickedUpAt)}</dd>
              </div>
            ) : null}
            {order.delivery.deliveredAt ? (
              <div className="flex justify-between gap-2">
                <dt>Entregue</dt>
                <dd>{formatDateTime(order.delivery.deliveredAt)}</dd>
              </div>
            ) : null}
          </dl>

          {order.delivery.status === "picked_up" ? (
            <div data-testid="delivery-location" className="mt-3 border-t border-zinc-100 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-zinc-900">Localização do entregador</h3>
                <Badge
                  variant={
                    mapState === "active" ? "success" : mapState === "waiting" ? "warning" : "muted"
                  }
                >
                  {DELIVERY_MAP_STATE_LABELS[mapState]}
                </Badge>
              </div>

              {trackingLocation ? (
                <>
                  <div className="mt-2">
                    <DeliveryMap
                      latitude={trackingLocation.latitude}
                      longitude={trackingLocation.longitude}
                    />
                  </div>
                  <p
                    data-testid="delivery-location-updated-at"
                    data-updated-at={trackingLocation.updatedAt}
                    className="mt-2 text-xs text-zinc-600"
                  >
                    Última posição recebida às{" "}
                    <strong className="font-semibold text-zinc-800">
                      {formatDateTime(trackingLocation.updatedAt)}
                    </strong>{" "}
                    · precisão aproximada ±{Math.round(trackingLocation.accuracyMeters)} m
                  </p>
                  {mapState === "stale" ? (
                    <p className="mt-1 text-xs text-amber-800">
                      Sem atualização há mais de 90 segundos. O entregador pode estar sem sinal ou
                      com a página em segundo plano.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-2 rounded-lg bg-zinc-50 px-3 py-3 text-xs leading-relaxed text-zinc-600">
                  Aguardando o entregador compartilhar a localização. O envio depende da autorização
                  do GPS no celular dele.
                </p>
              )}

              <p className="mt-2 text-xs text-zinc-500">
                Posição aproximada, visível apenas neste acompanhamento enquanto o pedido está em
                rota. Não há rota, distância ou previsão calculada.
              </p>
            </div>
          ) : null}

          {order.delivery.status === "delivered" ? (
            <p
              data-testid="delivery-location-ended"
              className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-500"
            >
              Entrega concluída. O compartilhamento de localização foi encerrado e a posição foi
              removida.
            </p>
          ) : null}
        </section>
      ) : null}

      {refreshError ? (
        <Alert variant="warning" title="Atualização indisponível">
          {refreshError}
        </Alert>
      ) : null}

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-900">Itens</h2>
        <ul className="mt-3 divide-y divide-zinc-100">
          {order.items.map((item) => (
            <li key={item.id} className="py-2.5">
              <div className="flex items-start justify-between gap-3 text-sm">
                <span className="font-medium text-zinc-800">
                  {item.quantity}x {item.productName}
                </span>
                <span className="font-medium whitespace-nowrap text-zinc-800">
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

        <dl className="mt-3 space-y-1 border-t border-zinc-100 pt-3 text-sm">
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
          <div className="flex justify-between pt-1 text-base font-semibold text-zinc-900">
            <dt>Total</dt>
            <dd>{formatCurrency(order.totalCents)}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-900">Pagamento</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant={order.paymentStatus === "paid" ? "success" : "warning"}>
            {PAYMENT_STATUS_LABELS[order.paymentStatus]}
          </Badge>
          <span className="text-sm text-zinc-600">
            {PAYMENT_METHOD_LABELS[order.paymentMethod]}
          </span>
        </div>

        {order.paymentMethod === "pix" && order.paymentStatus === "pending" ? (
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            O pagamento via Pix é conferido manualmente pela loja. Envie o comprovante pelo contato
            do estabelecimento. O status do pedido não muda automaticamente por causa do pagamento.
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-900">
          {order.fulfillmentType === "delivery" ? "Endereço de entrega" : "Retirada"}
        </h2>

        {order.fulfillmentType === "delivery" && order.deliveryAddress ? (
          <div className="mt-2 space-y-0.5 text-sm text-zinc-600">
            <p className="font-medium text-zinc-800">
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
        ) : (
          <p className="mt-2 text-sm text-zinc-600">
            Retirada no local. {order.store.phone ? `Contato: ${order.store.phone}.` : ""}
          </p>
        )}

        {order.notes ? (
          <p className="mt-3 border-t border-zinc-100 pt-3 text-sm text-zinc-600 italic">
            “{order.notes}”
          </p>
        ) : null}
      </section>

      {order.events.length > 0 ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Histórico</h2>
          <ul className="mt-2 space-y-1.5 text-xs text-zinc-500">
            {order.events.map((event) => (
              <li key={`${event.status}-${event.createdAt}`}>
                {formatDateTime(event.createdAt)} · {ORDER_STATUS_LABELS[event.status]}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 pb-6">
        <p className="text-xs text-zinc-500">
          {checkedAt ? `Atualizado às ${formatDateTime(checkedAt)}` : null}
          {isTerminalStatus(order.status) ? " · Acompanhamento encerrado" : " · Atualiza sozinho"}
        </p>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={refreshing}
            onClick={() => void load()}
          >
            {refreshing ? "Atualizando..." : "Atualizar agora"}
          </Button>
          <Link
            href={`/loja/${order.store.slug}`}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50"
          >
            Ver cardápio
          </Link>
        </div>
      </div>
    </div>
  );
}
