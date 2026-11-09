import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseRouteClient } from "@/lib/supabase/route";
import { getSiteOrigin } from "@/modules/auth/site-url";
import { ACTIVE_STORE_COOKIE } from "@/modules/stores/active-store";

export async function POST(request: NextRequest) {
  // `request.url` is the internal host behind a reverse proxy, so the redirect
  // target must be built from the public origin instead.
  const origin = await getSiteOrigin();
  const response = NextResponse.redirect(new URL("/login", origin), { status: 303 });

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseRouteClient(request, response);
    await supabase?.auth.signOut();
  }

  response.cookies.delete(ACTIVE_STORE_COOKIE);

  return response;
}
