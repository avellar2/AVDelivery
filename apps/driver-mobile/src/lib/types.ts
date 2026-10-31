export type DeliveryStatus = "assigned" | "picked_up" | "delivered" | "canceled";
export type OrderStatus =
  | "pending"
  | "accepted"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "delivered"
  | "canceled";

export type DeliveryRow = {
  id: string;
  store_id: string;
  order_id: string;
  driver_profile_id: string;
  status: DeliveryStatus;
  assigned_at: string;
  picked_up_at: string | null;
  delivered_at: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
};

export type OrderRow = {
  id: string;
  store_id: string;
  order_number: number;
  customer_name: string;
  customer_phone: string;
  fulfillment_type: "delivery" | "pickup";
  delivery_address_snapshot: DeliveryAddress | null;
  payment_method: "pix" | "cash" | "card_on_delivery";
  payment_status: "pending" | "paid" | "canceled";
  status: OrderStatus;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  notes: string | null;
  created_at: string;
};

export type DeliveryAddress = {
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  reference?: string;
  postalCode?: string;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  product_name_snapshot: string;
  unit_price_cents: number;
  quantity: number;
  total_cents: number;
  notes: string | null;
};

export type OrderItemOptionRow = {
  id: string;
  order_item_id: string;
  option_group_name_snapshot: string;
  option_name_snapshot: string;
  additional_price_cents: number;
  quantity: number;
};

export type DriverDelivery = {
  delivery: DeliveryRow;
  order: OrderRow | null;
  items: Array<OrderItemRow & { options: OrderItemOptionRow[] }>;
};

export type MembershipRow = {
  id: string;
  store_id: string;
  role: string;
};

export type StoreRow = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
};

export type DriverStore = {
  storeId: string;
  storeName: string;
  storeSlug: string;
  storeActive: boolean;
  driverProfileId: string | null;
  driverActive: boolean;
  displayName: string | null;
};

export type DriverProfileRow = {
  id: string;
  store_id: string;
  user_id: string;
  display_name: string;
  active: boolean;
};

export type TrackingLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  recordedAt: string;
  updatedAt: string;
};

export type TrackingStatus = {
  running: boolean;
  deliveryId: string | null;
  state: "idle" | "starting" | "tracking" | "offline" | "error" | "stopped";
  message: string | null;
  lastSentAt: number | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastAccuracy: number | null;
  queued: number;
  sentCount: number;
};
