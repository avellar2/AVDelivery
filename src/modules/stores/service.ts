import "server-only";

import { cache } from "react";

import { DatabaseError, NotFoundError } from "@/lib/errors";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type StoreSettingsData = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  phone: string | null;
  logoUrl: string | null;
  active: boolean;
};

export type PublicStoreData = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  phone: string | null;
  logoUrl: string | null;
};

export async function getStoreSettings(storeId: string): Promise<StoreSettingsData> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("stores")
    .select("id, name, slug, description, phone, logo_url, active")
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
  };
}

export const getPublicStoreBySlug = cache(async (slug: string): Promise<PublicStoreData | null> => {
  const supabase = createSupabasePublicClient();
  const { data, error } = await supabase
    .from("stores")
    .select("id, name, slug, description, phone, logo_url")
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
  };
});
