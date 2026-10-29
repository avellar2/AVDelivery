import { NextResponse, type NextRequest } from "next/server";

import { refreshSession } from "@/lib/supabase/proxy";

const CACHE_HEADERS = new Set(["cache-control", "expires", "pragma"]);

function redirectWithSession(
  request: NextRequest,
  pathname: string,
  response: NextResponse,
  searchParams?: Record<string, string>,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";

  for (const [key, value] of Object.entries(searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  const redirectResponse = NextResponse.redirect(url);

  for (const cookie of response.cookies.getAll()) {
    redirectResponse.cookies.set(cookie);
  }

  response.headers.forEach((value, key) => {
    if (CACHE_HEADERS.has(key.toLowerCase())) {
      redirectResponse.headers.set(key, value);
    }
  });

  return redirectResponse;
}

export async function proxy(request: NextRequest) {
  const { response, user } = await refreshSession(request);
  const { pathname, search } = request.nextUrl;

  const isProtectedRoute = pathname.startsWith("/dashboard") || pathname.startsWith("/admin");

  if (isProtectedRoute && !user) {
    return redirectWithSession(request, "/login", response, { next: `${pathname}${search}` });
  }

  if (pathname === "/login" && user) {
    return redirectWithSession(request, "/dashboard", response);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
