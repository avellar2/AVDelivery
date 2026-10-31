import type { PostgrestError, Session } from "@supabase/supabase-js";

import { assembleDriverDeliveries, mapRpcError, rpcErrorCode } from "./delivery";
import { requireSupabaseConfig } from "./env";
import { getSupabase } from "./supabase";
import type {
  DeliveryRow,
  DriverDelivery,
  DriverProfileRow,
  DriverStore,
  MembershipRow,
  OrderItemOptionRow,
  OrderItemRow,
  OrderRow,
  StoreRow,
  TrackingLocation,
} from "./types";

export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

function fail(error: PostgrestError | { message: string } | null, fallback: string): never {
  const code = rpcErrorCode(error);
  throw new ApiError(code, mapRpcError(code, fallback));
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    throw new ApiError(
      "auth_failed",
      error.message.toLowerCase().includes("invalid")
        ? "E-mail ou senha inválidos."
        : "Não foi possível entrar. Tente novamente.",
    );
  }
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await getSupabase().auth.getSession();

  if (error) {
    return null;
  }

  return data.session;
}

export async function listDriverStores(): Promise<DriverStore[]> {
  const supabase = getSupabase();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    throw new ApiError("unauthorized", "Sua sessão expirou. Entre novamente.");
  }

  const { data: memberships, error } = await supabase
    .from("store_memberships")
    .select("id, store_id, role")
    .eq("user_id", userData.user.id)
    .eq("role", "driver");

  if (error) {
    fail(error, "Não foi possível carregar suas lojas.");
  }

  const rows = (memberships ?? []) as MembershipRow[];

  if (rows.length === 0) {
    return [];
  }

  const storeIds = rows.map((row) => row.store_id);

  const { data: stores, error: storesError } = await supabase
    .from("stores")
    .select("id, name, slug, active")
    .in("id", storeIds)
    .order("name", { ascending: true });

  if (storesError) {
    fail(storesError, "Não foi possível carregar suas lojas.");
  }

  const { data: profiles, error: profilesError } = await supabase
    .from("driver_profiles")
    .select("id, store_id, user_id, display_name, active")
    .eq("user_id", userData.user.id)
    .in("store_id", storeIds);

  if (profilesError) {
    fail(profilesError, "Não foi possível carregar seu perfil de entregador.");
  }

  const profileByStore = new Map<string, DriverProfileRow>(
    ((profiles ?? []) as DriverProfileRow[]).map((profile) => [profile.store_id, profile]),
  );

  return ((stores ?? []) as StoreRow[]).map((store) => {
    const profile = profileByStore.get(store.id) ?? null;

    return {
      storeId: store.id,
      storeName: store.name,
      storeSlug: store.slug,
      storeActive: store.active,
      driverProfileId: profile?.id ?? null,
      driverActive: profile?.active ?? false,
      displayName: profile?.display_name ?? null,
    };
  });
}

export async function listDriverDeliveries(storeId: string): Promise<DriverDelivery[]> {
  const supabase = getSupabase();

  const { data: deliveryRows, error } = await supabase
    .from("deliveries")
    .select(
      "id, store_id, order_id, driver_profile_id, status, assigned_at, picked_up_at, delivered_at, canceled_at, cancel_reason, created_at",
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) {
    fail(error, "Não foi possível carregar suas entregas.");
  }

  const deliveries = (deliveryRows ?? []) as DeliveryRow[];

  if (deliveries.length === 0) {
    return [];
  }

  const orderIds = deliveries.map((delivery) => delivery.order_id);

  const { data: orderRows, error: ordersError } = await supabase
    .from("orders")
    .select(
      "id, store_id, order_number, customer_name, customer_phone, fulfillment_type, delivery_address_snapshot, payment_method, payment_status, status, subtotal_cents, delivery_fee_cents, total_cents, notes, created_at",
    )
    .in("id", orderIds);

  if (ordersError) {
    fail(ordersError, "Não foi possível carregar os pedidos.");
  }

  const orders = (orderRows ?? []) as OrderRow[];

  if (orders.length === 0) {
    return assembleDriverDeliveries(deliveries, [], [], []);
  }

  const readableOrderIds = orders.map((order) => order.id);

  const { data: itemRows, error: itemsError } = await supabase
    .from("order_items")
    .select(
      "id, order_id, product_name_snapshot, unit_price_cents, quantity, total_cents, notes",
    )
    .in("order_id", readableOrderIds);

  if (itemsError) {
    fail(itemsError, "Não foi possível carregar os itens do pedido.");
  }

  const items = (itemRows ?? []) as OrderItemRow[];
  const itemIds = items.map((item) => item.id);

  let options: OrderItemOptionRow[] = [];

  if (itemIds.length > 0) {
    const { data: optionRows, error: optionsError } = await supabase
      .from("order_item_options")
      .select(
        "id, order_item_id, option_group_name_snapshot, option_name_snapshot, additional_price_cents, quantity",
      )
      .in("order_item_id", itemIds);

    if (optionsError) {
      fail(optionsError, "Não foi possível carregar os complementos do pedido.");
    }

    options = (optionRows ?? []) as OrderItemOptionRow[];
  }

  return assembleDriverDeliveries(deliveries, orders, items, options);
}

export async function startDelivery(deliveryId: string): Promise<void> {
  const { error } = await getSupabase().rpc("start_delivery", { p_delivery_id: deliveryId });

  if (error) {
    fail(error, "Não foi possível iniciar a entrega.");
  }
}

export async function completeDelivery(deliveryId: string): Promise<void> {
  const { error } = await getSupabase().rpc("complete_delivery", { p_delivery_id: deliveryId });

  if (error) {
    fail(error, "Não foi possível concluir a entrega.");
  }
}

export async function clearDeliveryLocation(deliveryId: string): Promise<void> {
  const { error } = await getSupabase().rpc("clear_delivery_location", {
    p_delivery_id: deliveryId,
  });

  if (error) {
    fail(error, "Não foi possível interromper o compartilhamento.");
  }
}

export async function shareDeliveryLocation(
  deliveryId: string,
  latitude: number,
  longitude: number,
  accuracyMeters: number,
  recordedAt: string,
): Promise<{ changed: boolean; reason?: string }> {
  const { data, error } = await getSupabase().rpc("share_delivery_location", {
    p_delivery_id: deliveryId,
    p_latitude: latitude,
    p_longitude: longitude,
    p_accuracy_meters: accuracyMeters,
    p_recorded_at: recordedAt,
  });

  if (error) {
    fail(error, "Não foi possível enviar a localização.");
  }

  return (data ?? { changed: false }) as { changed: boolean; reason?: string };
}

export async function getDeliveryLocation(deliveryId: string): Promise<TrackingLocation | null> {
  const { data, error } = await getSupabase().rpc("get_driver_delivery_location", {
    p_delivery_id: deliveryId,
  });

  if (error) {
    if (rpcErrorCode(error) === "delivery_not_found") {
      return null;
    }

    fail(error, "Não foi possível consultar a localização.");
  }

  if (!data) {
    return null;
  }

  const payload = data as {
    latitude: number;
    longitude: number;
    accuracyMeters: number;
    recordedAt: string;
    updatedAt: string;
  };

  return {
    latitude: payload.latitude,
    longitude: payload.longitude,
    accuracyMeters: payload.accuracyMeters,
    recordedAt: payload.recordedAt,
    updatedAt: payload.updatedAt,
  };
}

export type TrackingSession = {
  url: string;
  anonKey: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
};

export async function getTrackingSession(): Promise<TrackingSession | null> {
  const session = await getSession();

  if (!session?.user) {
    return null;
  }

  const { url, anonKey } = requireSupabaseConfig();

  return {
    url,
    anonKey,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: (session.expires_at ?? 0) * 1000,
    userId: session.user.id,
  };
}
