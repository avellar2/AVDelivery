import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/modules/auth/session";

export const isPlatformAdmin = cache(async (userId: string): Promise<boolean> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return false;
  }

  return Boolean(data);
});

export async function requirePlatformAdmin() {
  const user = await requireUser();
  const admin = await isPlatformAdmin(user.id);

  if (!admin) {
    redirect("/dashboard");
  }

  return user;
}
