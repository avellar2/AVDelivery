import { NextResponse } from "next/server";

/**
 * Builds a same-origin redirect with a relative `Location`.
 *
 * `NextResponse.redirect` requires an absolute URL, but behind a reverse proxy
 * the only origin the Node server knows is the internal one (`localhost:PORT`).
 * Building the URL from `request.url` therefore sends browsers to a dead
 * address (observed on Render as `ERR_CONNECTION_REFUSED`). A relative
 * `Location` keeps the redirect on the origin the browser is already using and
 * removes any dependency on `Host`/`X-Forwarded-*` headers.
 */
export function redirectToPath(path: string, status = 307): NextResponse {
  return new NextResponse(null, {
    status,
    headers: { location: path },
  });
}
