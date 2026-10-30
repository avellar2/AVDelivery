import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DatabaseError } from "@/lib/errors";
import { isActiveDeliveryStatus } from "@/modules/deliveries/constants";
import type {
  DeliverySummary,
  DriverDelivery,
  DriverProfileSummary,
} from "@/modules/deliveries/types";
import { getOrderSummariesByIds } from "@/modules/orders/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, DeliveryStatus } from "@/types/database";

type Client = SupabaseClient<Database>;

type DeliveryRow = {
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
};

function mapDelivery(row: DeliveryRow, driverName: string): DeliverySummary {
  return {
    id: row.id,
    orderId: row.order_id,
    status: row.status,
    driverProfileId: row.driver_profile_id,
    driverName,
    assignedAt: row.assigned_at,
    pickedUpAt: row.picked_up_at,
    deliveredAt: row.delivered_at,
    canceledAt: row.canceled_at,
    cancelReason: row.cancel_reason,
  };
}

export async function listDriversForStore(storeId: string): Promise<DriverProfileSummary[]> {
  const supabase = await createSupabaseServerClient();

  const { data: drivers, error } = await supabase
    .from("driver_profiles")
    .select("id, store_id, user_id, display_name, phone, active, created_at")
    .eq("store_id", storeId)
    .order("display_name", { ascending: true });

  if (error) {
    throw new DatabaseError("deliveries.listDrivers", error);
  }

  const driverIds = (drivers ?? []).map((driver) => driver.id);

  if (driverIds.length === 0) {
    return [];
  }

  const { data: deliveries, error: deliveriesError } = await supabase
    .from("deliveries")
    .select("driver_profile_id, status")
    .eq("store_id", storeId)
    .in("driver_profile_id", driverIds)
    .limit(1000);

  if (deliveriesError) {
    throw new DatabaseError("deliveries.countByDriver", deliveriesError);
  }

  const active = new Map<string, number>();
  const completed = new Map<string, number>();

  for (const delivery of deliveries ?? []) {
    if (isActiveDeliveryStatus(delivery.status)) {
      active.set(delivery.driver_profile_id, (active.get(delivery.driver_profile_id) ?? 0) + 1);
    } else if (delivery.status === "delivered") {
      completed.set(
        delivery.driver_profile_id,
        (completed.get(delivery.driver_profile_id) ?? 0) + 1,
      );
    }
  }

  return (drivers ?? []).map((driver) => ({
    id: driver.id,
    storeId: driver.store_id,
    userId: driver.user_id,
    displayName: driver.display_name,
    phone: driver.phone,
    active: driver.active,
    createdAt: driver.created_at,
    activeDeliveries: active.get(driver.id) ?? 0,
    completedDeliveries: completed.get(driver.id) ?? 0,
  }));
}

async function loadDriverDeliveries(
  supabase: Client,
  driverProfileIds: string[],
  storeId: string,
): Promise<DeliveryRow[]> {
  if (driverProfileIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("deliveries")
    .select(
      "id, store_id, order_id, driver_profile_id, status, assigned_at, picked_up_at, delivered_at, canceled_at, cancel_reason",
    )
    .eq("store_id", storeId)
    .in("driver_profile_id", driverProfileIds)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new DatabaseError("deliveries.listForDriver", error);
  }

  return data ?? [];
}

export async function getDriverProfileForStore(
  userId: string,
  storeId: string,
): Promise<{ id: string; displayName: string; active: boolean } | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("driver_profiles")
    .select("id, display_name, active")
    .eq("user_id", userId)
    .eq("store_id", storeId)
    .maybeSingle();

  if (error) {
    throw new DatabaseError("deliveries.getDriverProfileForStore", error);
  }

  if (!data) {
    return null;
  }

  return { id: data.id, displayName: data.display_name, active: data.active };
}

export async function getDriverDeliveriesForStore(
  userId: string,
  storeId: string,
): Promise<DriverDelivery[]> {
  const supabase = await createSupabaseServerClient();

  const { data: profiles, error } = await supabase
    .from("driver_profiles")
    .select("id, display_name, store_id")
    .eq("user_id", userId)
    .eq("store_id", storeId);

  if (error) {
    throw new DatabaseError("deliveries.driverProfiles", error);
  }

  if (!profiles || profiles.length === 0) {
    return [];
  }

  const profileIds = profiles.map((profile) => profile.id);
  const driverName = profiles[0]?.display_name ?? "Entregador";
  const deliveries = await loadDriverDeliveries(supabase, profileIds, storeId);
  const orders = await getOrderSummariesByIds(deliveries.map((delivery) => delivery.order_id));

  return deliveries.flatMap((delivery) => {
    const order = orders.get(delivery.order_id);

    if (!order) {
      return [];
    }

    return [{ delivery: mapDelivery(delivery, driverName), order }];
  });
}

export async function getDriverDeliveryById(
  deliveryId: string,
  userId: string,
): Promise<DriverDelivery | null> {
  const supabase = await createSupabaseServerClient();

  const { data: delivery, error } = await supabase
    .from("deliveries")
    .select(
      "id, store_id, order_id, driver_profile_id, status, assigned_at, picked_up_at, delivered_at, canceled_at, cancel_reason",
    )
    .eq("id", deliveryId)
    .maybeSingle();

  if (error) {
    throw new DatabaseError("deliveries.getForDriver", error);
  }

  if (!delivery) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("driver_profiles")
    .select("id, display_name, user_id")
    .eq("id", delivery.driver_profile_id)
    .maybeSingle();

  if (profileError) {
    throw new DatabaseError("deliveries.getDriverProfile", profileError);
  }

  if (!profile || profile.user_id !== userId) {
    return null;
  }

  const orders = await getOrderSummariesByIds([delivery.order_id]);
  const order = orders.get(delivery.order_id);

  if (!order) {
    return null;
  }

  return { delivery: mapDelivery(delivery, profile.display_name), order };
}

export async function countDeliveriesForStore(storeId: string): Promise<{
  active: number;
  completedToday: number;
}> {
  const supabase = await createSupabaseServerClient();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data: active, error: activeError } = await supabase
    .from("deliveries")
    .select("id")
    .eq("store_id", storeId)
    .in("status", ["assigned", "picked_up"])
    .limit(1000);

  if (activeError) {
    throw new DatabaseError("deliveries.countActive", activeError);
  }

  const { data: completed, error: completedError } = await supabase
    .from("deliveries")
    .select("id")
    .eq("store_id", storeId)
    .eq("status", "delivered")
    .gte("delivered_at", startOfDay.toISOString())
    .limit(1000);

  if (completedError) {
    throw new DatabaseError("deliveries.countCompleted", completedError);
  }

  return {
    active: active?.length ?? 0,
    completedToday: completed?.length ?? 0,
  };
}
