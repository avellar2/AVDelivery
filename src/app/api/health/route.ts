export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public liveness probe for the hosting platform and external uptime monitors.
 *
 * It intentionally exposes no internals: no counters, no database, no provider
 * data, no configuration. Financial health (worker, reconciliation, backlog and
 * dead letters) lives behind authentication at `/api/internal/billing/health`,
 * which needs the dedicated job secret.
 */
export function GET(): Response {
  return Response.json(
    { status: "ok" },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
