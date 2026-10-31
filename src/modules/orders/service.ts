import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DatabaseError, NotFoundError } from "@/lib/errors";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  CheckoutAddress,
  CheckoutInput,
  OrderDetail,
  OrderEventSummary,
  OrderItemOptionSummary,
  OrderItemSummary,
  OrderStatusCounts,
  OrderSummary,
  StoreCheckoutSettings,
  TrackingOrder,
} from "@/modules/orders/types";
import type { DeliverySummary, TrackingDelivery } from "@/modules/deliveries/types";
import { isDeliveryStatus } from "@/modules/deliveries/constants";
import type { TrackingLocation } from "@/modules/tracking/types";
import type {
  Database,
  DeliveryStatus,
  Json,
  OrderFulfillmentType,
  OrderPaymentMethod,
  OrderPaymentStatus,
  OrderStatus,
} from "@/types/database";

type Client = SupabaseClient<Database>;

type OrderRowSelected = {
  id: string;
  order_number: number;
  status: OrderStatus;
  payment_status: OrderPaymentStatus;
  payment_method: OrderPaymentMethod;
  fulfillment_type: OrderFulfillmentType;
  customer_name: string;
  customer_phone: string;
  delivery_address_snapshot: Json | null;
  notes: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  created_at: string;
  updated_at: string;
};

type OrderItemRowSelected = {
  id: string;
  order_id: string;
  product_name_snapshot: string;
  unit_price_cents: number;
  quantity: number;
  total_cents: number;
  notes: string | null;
};

type OrderItemOptionRowSelected = {
  order_item_id: string;
  option_group_name_snapshot: string;
  option_name_snapshot: string;
  additional_price_cents: number;
  quantity: number;
};

function text(value: Json | undefined): string {
  return typeof value === "string" ? value : "";
}

function mapAddress(value: Json | null): CheckoutAddress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, Json>;

  return {
    street: text(record.street),
    number: text(record.number),
    complement: text(record.complement),
    district: text(record.district),
    city: text(record.city),
    reference: text(record.reference),
    postalCode: text(record.postalCode),
  };
}

function mapOptions(rows: OrderItemOptionRowSelected[]): OrderItemOptionSummary[] {
  return rows.map((row) => ({
    groupName: row.option_group_name_snapshot,
    name: row.option_name_snapshot,
    additionalPriceCents: row.additional_price_cents,
    quantity: row.quantity,
  }));
}

function mapItems(
  items: OrderItemRowSelected[],
  optionsByItem: Map<string, OrderItemOptionRowSelected[]>,
): OrderItemSummary[] {
  return items.map((item) => ({
    id: item.id,
    productName: item.product_name_snapshot,
    unitPriceCents: item.unit_price_cents,
    quantity: item.quantity,
    totalCents: item.total_cents,
    notes: item.notes,
    options: mapOptions(optionsByItem.get(item.id) ?? []),
  }));
}

function mapSummary(order: OrderRowSelected, items: OrderItemSummary[]): OrderSummary {
  return {
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    paymentStatus: order.payment_status,
    paymentMethod: order.payment_method,
    fulfillmentType: order.fulfillment_type,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    deliveryAddress: mapAddress(order.delivery_address_snapshot),
    notes: order.notes,
    subtotalCents: order.subtotal_cents,
    deliveryFeeCents: order.delivery_fee_cents,
    totalCents: order.total_cents,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    items,
    activeDelivery: null,
  };
}

async function loadItems(
  supabase: Client,
  orderIds: string[],
): Promise<{
  itemsByOrder: Map<string, OrderItemRowSelected[]>;
  optionsByItem: Map<string, OrderItemOptionRowSelected[]>;
}> {
  const itemsByOrder = new Map<string, OrderItemRowSelected[]>();
  const optionsByItem = new Map<string, OrderItemOptionRowSelected[]>();

  if (orderIds.length === 0) {
    return { itemsByOrder, optionsByItem };
  }

  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("id, order_id, product_name_snapshot, unit_price_cents, quantity, total_cents, notes")
    .in("order_id", orderIds)
    .order("created_at", { ascending: true });

  if (itemsError) {
    throw new DatabaseError("orders.loadItems", itemsError);
  }

  const itemIds: string[] = [];

  for (const item of items ?? []) {
    const current = itemsByOrder.get(item.order_id) ?? [];
    current.push(item);
    itemsByOrder.set(item.order_id, current);
    itemIds.push(item.id);
  }

  if (itemIds.length === 0) {
    return { itemsByOrder, optionsByItem };
  }

  const { data: options, error: optionsError } = await supabase
    .from("order_item_options")
    .select(
      "order_item_id, option_group_name_snapshot, option_name_snapshot, additional_price_cents, quantity",
    )
    .in("order_item_id", itemIds)
    .order("option_name_snapshot", { ascending: true });

  if (optionsError) {
    throw new DatabaseError("orders.loadItemOptions", optionsError);
  }

  for (const option of options ?? []) {
    const current = optionsByItem.get(option.order_item_id) ?? [];
    current.push(option);
    optionsByItem.set(option.order_item_id, current);
  }

  return { itemsByOrder, optionsByItem };
}

const ORDER_COLUMNS =
  "id, order_number, status, payment_status, payment_method, fulfillment_type, customer_name, customer_phone, delivery_address_snapshot, notes, subtotal_cents, delivery_fee_cents, total_cents, created_at, updated_at";

type DeliveryRowSelected = {
  id: string;
  order_id: string;
  driver_profile_id: string;
  status: DeliveryStatus;
  assigned_at: string;
  picked_up_at: string | null;
  delivered_at: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
};

async function loadDeliveries(
  supabase: Client,
  orderIds: string[],
  includeFinished: boolean,
): Promise<Map<string, DeliverySummary[]>> {
  const deliveriesByOrder = new Map<string, DeliverySummary[]>();

  if (orderIds.length === 0) {
    return deliveriesByOrder;
  }

  let query = supabase
    .from("deliveries")
    .select(
      "id, order_id, driver_profile_id, status, assigned_at, picked_up_at, delivered_at, canceled_at, cancel_reason",
    )
    .in("order_id", orderIds)
    .order("created_at", { ascending: true });

  if (!includeFinished) {
    query = query.in("status", ["assigned", "picked_up"]);
  }

  const { data: deliveries, error } = await query;

  if (error) {
    throw new DatabaseError("deliveries.loadForOrders", error);
  }

  const rows = (deliveries ?? []) as DeliveryRowSelected[];

  if (rows.length === 0) {
    return deliveriesByOrder;
  }

  const driverIds = [...new Set(rows.map((row) => row.driver_profile_id))];
  const { data: drivers, error: driversError } = await supabase
    .from("driver_profiles")
    .select("id, display_name")
    .in("id", driverIds);

  if (driversError) {
    throw new DatabaseError("deliveries.loadDrivers", driversError);
  }

  const driversById = new Map((drivers ?? []).map((driver) => [driver.id, driver.display_name]));

  for (const row of rows) {
    const current = deliveriesByOrder.get(row.order_id) ?? [];
    current.push({
      id: row.id,
      orderId: row.order_id,
      status: row.status,
      driverProfileId: row.driver_profile_id,
      driverName: driversById.get(row.driver_profile_id) ?? "Entregador",
      assignedAt: row.assigned_at,
      pickedUpAt: row.picked_up_at,
      deliveredAt: row.delivered_at,
      canceledAt: row.canceled_at,
      cancelReason: row.cancel_reason,
    });
    deliveriesByOrder.set(row.order_id, current);
  }

  return deliveriesByOrder;
}

function activeDeliveryOf(deliveries: DeliverySummary[]): DeliverySummary | null {
  return (
    deliveries.find(
      (delivery) => delivery.status === "assigned" || delivery.status === "picked_up",
    ) ?? null
  );
}

function mapTrackingLocation(value: unknown): TrackingLocation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const latitude = Number(record.latitude);
  const longitude = Number(record.longitude);
  const accuracyMeters = Number(record.accuracyMeters);
  const recordedAt = typeof record.recordedAt === "string" ? record.recordedAt : null;
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : null;

  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(accuracyMeters) ||
    accuracyMeters <= 0 ||
    !recordedAt ||
    !updatedAt
  ) {
    return null;
  }

  return { latitude, longitude, accuracyMeters, recordedAt, updatedAt };
}

function mapTrackingDelivery(value: unknown): TrackingDelivery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (!isDeliveryStatus(record.status)) {
    return null;
  }

  return {
    status: record.status,
    assignedAt: typeof record.assignedAt === "string" ? record.assignedAt : null,
    pickedUpAt: typeof record.pickedUpAt === "string" ? record.pickedUpAt : null,
    deliveredAt: typeof record.deliveredAt === "string" ? record.deliveredAt : null,
    location: mapTrackingLocation(record.location),
  };
}

export async function getCheckoutStoreBySlug(slug: string): Promise<
  | (StoreCheckoutSettings & {
      id: string;
      name: string;
      slug: string;
      phone: string | null;
    })
  | null
> {
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from("stores")
    .select(
      "id, name, slug, phone, active, accepting_orders, delivery_enabled, pickup_enabled, delivery_fee_cents, min_order_cents, payment_pix_enabled, payment_cash_enabled, payment_card_on_delivery_enabled, pix_key, pix_receiver_name",
    )
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw new DatabaseError("orders.getCheckoutStore", error);
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    phone: data.phone,
    acceptingOrders: data.accepting_orders,
    deliveryEnabled: data.delivery_enabled,
    pickupEnabled: data.pickup_enabled,
    deliveryFeeCents: data.delivery_fee_cents,
    minOrderCents: data.min_order_cents,
    paymentPixEnabled: data.payment_pix_enabled,
    paymentCashEnabled: data.payment_cash_enabled,
    paymentCardOnDeliveryEnabled: data.payment_card_on_delivery_enabled,
    pixKey: data.pix_key,
    pixReceiverName: data.pix_receiver_name,
  };
}

export async function createOrderRecord(params: {
  storeSlug: string;
  payload: CheckoutInput;
  idempotencyKey: string;
  requestHash: string;
  trackingTokenHash: string;
}): Promise<Json> {
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.rpc("create_order", {
    p_store_slug: params.storeSlug,
    p_payload: params.payload as unknown as Json,
    p_idempotency_key: params.idempotencyKey,
    p_request_hash: params.requestHash,
    p_tracking_token_hash: params.trackingTokenHash,
  });

  if (error) {
    throw new DatabaseError("orders.create", error);
  }

  return data;
}

export async function getTrackingOrder(params: {
  storeSlug: string;
  orderNumber: number;
  trackingTokenHash: string;
}): Promise<TrackingOrder | null> {
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase.rpc("get_order_tracking", {
    p_store_slug: params.storeSlug,
    p_order_number: params.orderNumber,
    p_tracking_token_hash: params.trackingTokenHash,
  });

  if (error) {
    throw new DatabaseError("orders.getTracking", error);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const record = data as unknown as TrackingOrder;

  if (!record.orderNumber) {
    return null;
  }

  return {
    ...record,
    delivery: mapTrackingDelivery(record.delivery),
    deliveryAddress: mapAddress((record.deliveryAddress ?? null) as Json | null),
    items: Array.isArray(record.items) ? record.items : [],
    events: Array.isArray(record.events) ? record.events : [],
  };
}

export async function listOrdersForStore(
  storeId: string,
  status: OrderStatus | null,
): Promise<OrderSummary[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (status) {
    query = query.eq("status", status);
  }

  const { data: orders, error } = await query;

  if (error) {
    throw new DatabaseError("orders.list", error);
  }

  const orderRows = orders ?? [];
  const orderIds = orderRows.map((order) => order.id);
  const [{ itemsByOrder, optionsByItem }, deliveriesByOrder] = await Promise.all([
    loadItems(supabase, orderIds),
    loadDeliveries(supabase, orderIds, false),
  ]);

  return orderRows.map((order) => {
    const deliveries = deliveriesByOrder.get(order.id) ?? [];

    return {
      ...mapSummary(order, mapItems(itemsByOrder.get(order.id) ?? [], optionsByItem)),
      activeDelivery: activeDeliveryOf(deliveries),
    };
  });
}

export async function getOrderSummariesByIds(
  orderIds: string[],
): Promise<Map<string, OrderSummary>> {
  const summaries = new Map<string, OrderSummary>();

  if (orderIds.length === 0) {
    return summaries;
  }

  const supabase = await createSupabaseServerClient();
  const { data: orders, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .in("id", orderIds)
    .limit(200);

  if (error) {
    throw new DatabaseError("orders.listByIds", error);
  }

  const orderRows = orders ?? [];
  const ids = orderRows.map((order) => order.id);
  const [{ itemsByOrder, optionsByItem }, deliveriesByOrder] = await Promise.all([
    loadItems(supabase, ids),
    loadDeliveries(supabase, ids, false),
  ]);

  for (const order of orderRows) {
    const deliveries = deliveriesByOrder.get(order.id) ?? [];

    summaries.set(order.id, {
      ...mapSummary(order, mapItems(itemsByOrder.get(order.id) ?? [], optionsByItem)),
      activeDelivery: activeDeliveryOf(deliveries),
    });
  }

  return summaries;
}

export async function getOrderDetailForStore(
  storeId: string,
  orderId: string,
): Promise<OrderDetail> {
  const supabase = await createSupabaseServerClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("store_id", storeId)
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    throw new DatabaseError("orders.getDetail", error);
  }

  if (!order) {
    throw new NotFoundError("Pedido não encontrado.");
  }

  const { itemsByOrder, optionsByItem } = await loadItems(supabase, [order.id]);
  const deliveriesByOrder = await loadDeliveries(supabase, [order.id], true);
  const deliveries = deliveriesByOrder.get(order.id) ?? [];

  const { data: events, error: eventsError } = await supabase
    .from("order_events")
    .select("previous_status, new_status, created_at")
    .eq("order_id", order.id)
    .order("created_at", { ascending: true });

  if (eventsError) {
    throw new DatabaseError("orders.getEvents", eventsError);
  }

  const mappedEvents: OrderEventSummary[] = (events ?? []).map((event) => ({
    previousStatus: event.previous_status,
    status: event.new_status,
    createdAt: event.created_at,
  }));

  return {
    ...mapSummary(order, mapItems(itemsByOrder.get(order.id) ?? [], optionsByItem)),
    activeDelivery: activeDeliveryOf(deliveries),
    deliveries,
    events: mappedEvents,
  };
}

export async function countOrdersByStatus(storeId: string): Promise<OrderStatusCounts> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("orders")
    .select("status")
    .eq("store_id", storeId)
    .limit(1000);

  if (error) {
    throw new DatabaseError("orders.countByStatus", error);
  }

  const counts: OrderStatusCounts = {
    pending: 0,
    accepted: 0,
    preparing: 0,
    ready: 0,
    out_for_delivery: 0,
    delivered: 0,
    canceled: 0,
  };

  for (const row of data ?? []) {
    counts[row.status] += 1;
  }

  return counts;
}
