import "server-only";

import { createClient } from "@supabase/supabase-js";

import { ConfigurationError } from "@/lib/errors";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import type { Database } from "@/types/database";

export function createSupabasePublicClient() {
  const config = getSupabasePublicConfig();

  if (!config) {
    throw new ConfigurationError();
  }

  return createClient<Database>(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
