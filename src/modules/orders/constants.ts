import type {
  OrderFulfillmentType,
  OrderPaymentMethod,
  OrderPaymentStatus,
  OrderStatus,
} from "@/types/database";

export const MAX_ORDER_ITEMS = 50;
export const MAX_ORDER_ITEM_OPTIONS = 50;
export const MAX_ITEM_QUANTITY = 99;
export const MAX_ORDER_NOTES = 500;
export const MAX_ITEM_NOTES = 300;
export const MAX_ADDRESS_FIELD = 160;

export const ORDER_STATUSES: readonly OrderStatus[] = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
  "canceled",
];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Novo pedido",
  accepted: "Aceito",
  preparing: "Em preparo",
  ready: "Pronto",
  out_for_delivery: "Saiu para entrega",
  delivered: "Entregue",
  canceled: "Cancelado",
};

export const ORDER_STATUS_SHORT_LABELS: Record<OrderStatus, string> = {
  pending: "Novo",
  accepted: "Aceito",
  preparing: "Preparando",
  ready: "Pronto",
  out_for_delivery: "Em entrega",
  delivered: "Entregue",
  canceled: "Cancelado",
};

export const ORDER_STATUS_TONES: Record<
  OrderStatus,
  "neutral" | "success" | "warning" | "muted" | "brand"
> = {
  pending: "warning",
  accepted: "brand",
  preparing: "brand",
  ready: "success",
  out_for_delivery: "brand",
  delivered: "success",
  canceled: "muted",
};

export const FULFILLMENT_LABELS: Record<OrderFulfillmentType, string> = {
  delivery: "Entrega",
  pickup: "Retirada",
};

export const PAYMENT_METHOD_LABELS: Record<OrderPaymentMethod, string> = {
  pix: "Pix manual",
  cash: "Dinheiro na entrega",
  card_on_delivery: "Cartão na entrega",
};

export const PAYMENT_STATUS_LABELS: Record<OrderPaymentStatus, string> = {
  pending: "Aguardando pagamento",
  paid: "Pago",
  canceled: "Pagamento cancelado",
};

export const TERMINAL_STATUSES: readonly OrderStatus[] = ["delivered", "canceled"];

export const CART_STORAGE_PREFIX = "avd_cart_";
export const TRACKING_STORAGE_KEY = "avd_order_tracking_tokens";
