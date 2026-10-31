import type {
  DeliveryRow,
  DriverDelivery,
  OrderItemOptionRow,
  OrderItemRow,
  OrderRow,
} from "./types";

export function rpcErrorCode(error: { message?: string } | null | undefined): string {
  const message = error?.message?.trim() ?? "";
  return message.split("|")[0]?.trim() ?? "";
}

export function mapRpcError(
  code: string,
  fallback = "Não foi possível concluir a ação. Tente novamente.",
): string {
  switch (code) {
    case "unauthorized":
      return "Sua sessão expirou. Entre novamente.";
    case "forbidden":
      return "Esta ação não pertence à sua conta.";
    case "delivery_not_found":
      return "Entrega não encontrada.";
    case "delivery_not_started":
      return "Inicie a entrega antes de compartilhar a localização.";
    case "delivery_completed":
      return "A entrega já foi concluída.";
    case "delivery_not_active":
      return "A entrega foi cancelada ou reatribuída.";
    case "driver_inactive":
    case "driver_not_member":
      return "Seu vínculo com a loja não permite esta ação.";
    case "order_not_out_for_delivery":
    case "order_not_available":
      return "O pedido não está mais em rota.";
    case "order_not_ready":
      return "O pedido ainda não está pronto para coleta.";
    case "pickup_required":
      return "Registre a coleta antes de concluir.";
    default:
      return fallback;
  }
}

export function assembleDriverDeliveries(
  deliveries: DeliveryRow[],
  orders: OrderRow[],
  items: OrderItemRow[],
  options: OrderItemOptionRow[],
): DriverDelivery[] {
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const optionsByItem = new Map<string, OrderItemOptionRow[]>();

  for (const option of options) {
    const current = optionsByItem.get(option.order_item_id) ?? [];
    current.push(option);
    optionsByItem.set(option.order_item_id, current);
  }

  const itemsByOrder = new Map<string, Array<OrderItemRow & { options: OrderItemOptionRow[] }>>();

  for (const item of items) {
    const current = itemsByOrder.get(item.order_id) ?? [];
    current.push({ ...item, options: optionsByItem.get(item.id) ?? [] });
    itemsByOrder.set(item.order_id, current);
  }

  return deliveries
    .map((delivery) => {
      const order = ordersById.get(delivery.order_id) ?? null;

      return { delivery, order, items: order ? (itemsByOrder.get(order.id) ?? []) : [] };
    })
    .sort((a, b) => b.delivery.created_at.localeCompare(a.delivery.created_at));
}

export function isActiveDelivery(status: DeliveryRow["status"]): boolean {
  return status === "assigned" || status === "picked_up";
}

export function canStart(delivery: DeliveryRow): boolean {
  return delivery.status === "assigned" && delivery.order_id.length > 0;
}

export function canComplete(delivery: DeliveryRow): boolean {
  return delivery.status === "picked_up";
}

export function canShare(delivery: DeliveryRow): boolean {
  return delivery.status === "picked_up";
}

export function formatAddress(address: DeliveryAddressLike | null | undefined): string {
  if (!address) {
    return "Endereço não informado";
  }

  const line = [address.street, address.number].filter(Boolean).join(", ");
  const district = address.district ? ` — ${address.district}` : "";
  const city = address.city ? `, ${address.city}` : "";
  const complement = address.complement ? ` (${address.complement})` : "";
  const reference = address.reference ? ` · Ref.: ${address.reference}` : "";

  return `${line || "Endereço não informado"}${complement}${district}${city}${reference}`;
}

type DeliveryAddressLike = {
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  reference?: string;
};
