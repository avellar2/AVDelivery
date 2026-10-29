import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { safeRedirectPath } from "@/lib/redirects";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

const ALLOWED_OTP_TYPES = new Set<EmailOtpType>([
  "recovery",
  "invite",
  "magiclink",
  "signup",
  "email_change",
  "email",
]);

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = url.origin;
  const next = safeRedirectPath(url.searchParams.get("next"), "/dashboard");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const code = url.searchParams.get("code");

  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  if (url.searchParams.get("error")) {
    return NextResponse.redirect(new URL("/login?error=link_invalido", origin));
  }

  const successResponse = NextResponse.redirect(new URL(next, origin));
  const failureResponse = NextResponse.redirect(new URL("/login?error=link_invalido", origin));
  const supabase = createSupabaseRouteClient(request, successResponse);

  if (!supabase) {
    return failureResponse;
  }

  if (tokenHash && type && ALLOWED_OTP_TYPES.has(type as EmailOtpType)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });

    if (!error) {
      return successResponse;
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return successResponse;
    }
  }

  return failureResponse;
}
