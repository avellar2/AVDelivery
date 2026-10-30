import "server-only";

import { createClient } from "@supabase/supabase-js";

import { ConfigurationError } from "@/lib/errors";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import type { Database } from "@/types/database";

export function createSupabaseAdminClient() {
  const config = getSupabasePublicConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!config || !serviceRoleKey || serviceRoleKey === config.anonKey) {
    throw new ConfigurationError(
      "A gestão de entregadores precisa da chave de serviço configurada no servidor.",
    );
  }

  return createClient<Database>(config.url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function findAuthUserByEmail(email: string) {
  const admin = createSupabaseAdminClient();
  const normalized = email.trim().toLowerCase();

  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });

    if (error) {
      throw error;
    }

    const users = data?.users ?? [];
    const found = users.find((user) => user.email?.toLowerCase() === normalized);

    if (found) {
      return found;
    }

    if (users.length < 1000) {
      return null;
    }
  }

  return null;
}
