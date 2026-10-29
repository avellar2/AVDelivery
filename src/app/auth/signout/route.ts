import { NextResponse, type NextRequest } from "next/server";

import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseRouteClient } from "@/lib/supabase/route";
import { ACTIVE_STORE_COOKIE } from "@/modules/stores/active-store";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 });

  if (isSupabaseConfigured()) {
    const supabase = createSupabaseRouteClient(request, response);
    await supabase?.auth.signOut();
  }

  response.cookies.delete(ACTIVE_STORE_COOKIE);

  return response;
}
