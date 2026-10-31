import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseConfig } from "./env";
import { secureSessionStorage } from "./secure-storage";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) {
    return client;
  }

  const { url, anonKey } = requireSupabaseConfig();

  client = createClient(url, anonKey, {
    auth: {
      storage: secureSessionStorage,
      storageKey: "avd-driver-auth",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
    global: {
      headers: {
        "X-Client-Info": "av-delivery-driver-android",
      },
    },
  });

  return client;
}

export async function getAccessToken(): Promise<string | null> {
  const { data, error } = await getSupabase().auth.getSession();

  if (error) {
    return null;
  }

  return data.session?.access_token ?? null;
}
