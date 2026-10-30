import "server-only";

import { cache } from "react";

import { DatabaseError, NotFoundError } from "@/lib/errors";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type StoreCheckoutSettingsData = {
  acceptingOrders: boolean;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  deliveryFeeCents: number;
  minOrderCents: number;
  paymentPixEnabled: boolean;
  paymentCashEnabled: boolean;
  paymentCardOnDeliveryEnabled: boolean;
  pixKey: string | null;
  pixReceiverName: string | null;
};

export type StoreSettingsData = StoreCheckoutSettingsData & {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  phone: string | null;
  logoUrl: string | null;
  active: boolean;
};

export type PublicStoreData = StoreCheckoutSettingsData & {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  phone: string | null;
  logoUrl: string | null;
};

const STORE_CHECKOUT_COLUMNS =
  "accepting_orders, delivery_enabled, pickup_enabled, delivery_fee_cents, min_order_cents, payment_pix_enabled, payment_cash_enabled, payment_card_on_delivery_enabled, pix_key, pix_receiver_name";

function mapCheckoutSettings(data: {
  accepting_orders: boolean;
  delivery_enabled: boolean;
  pickup_enabled: boolean;
  delivery_fee_cents: number;
  min_order_cents: number;
  payment_pix_enabled: boolean;
  payment_cash_enabled: boolean;
  payment_card_on_delivery_enabled: boolean;
  pix_key: string | null;
  pix_receiver_name: string | null;
}): StoreCheckoutSettingsData {
  return {
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

export async function getStoreSettings(storeId: string): Promise<StoreSettingsData> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("stores")
    .select(`id, name, slug, description, phone, logo_url, active, ${STORE_CHECKOUT_COLUMNS}`)
    .eq("id", storeId)
    .maybeSingle();

  if (error) {
    throw new DatabaseError("stores.getSettings", error);
  }

  if (!data) {
    throw new NotFoundError("Loja não encontrada.");
  }

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    description: data.description,
    phone: data.phone,
    logoUrl: data.logo_url,
    active: data.active,
    ...mapCheckoutSettings(data),
  };
}

export const getPublicStoreBySlug = cache(async (slug: string): Promise<PublicStoreData | null> => {
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from("stores")
    .select(`id, name, slug, description, phone, logo_url, ${STORE_CHECKOUT_COLUMNS}`)
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw new DatabaseError("stores.getPublicBySlug", error);
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    description: data.description,
    phone: data.phone,
    logoUrl: data.logo_url,
    ...mapCheckoutSettings(data),
  };
});
