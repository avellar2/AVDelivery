#!/usr/bin/env node
/**
 * Local scheduler for the Stage 7A internal billing routes.
 *
 * It exists because the durable inbox and the reconciliation only act when an
 * external scheduler calls the protected routes. This process is that caller
 * for homologation: one invocation of the webhook processor per minute and one
 * reconciliation every fifteen minutes, both over HTTPS with the dedicated
 * worker secret.
 *
 * It is not a queue and it is not a replacement for a real cron in a published
 * environment: it must be kept running by a supervisor. Prefer Vercel Cron,
 * Supabase Cron/pg_net or another managed scheduler for anything operational.
 *
 * Usage:
 *   npm run billing:schedule -- --base-url https://SEU-DOMINIO
 *
 * Environment:
 *   BILLING_SCHEDULER_BASE_URL  base URL (or pass --base-url)
 *   BILLING_WORKER_SECRET       dedicated secret (falls back to CRON_SECRET)
 *   BILLING_SCHEDULER_WORKER_MS      default 60000
 *   BILLING_SCHEDULER_RECONCILE_MS   default 900000
 *   BILLING_SCHEDULER_TIMEOUT_MS     default 55000
 */
const WORKER_PATH = "/api/internal/billing/worker";
const RECONCILE_PATH = "/api/internal/billing/reconcile";

function fail(message) {
  console.error(`[billing:schedule] ${message}`);
  process.exit(1);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveInt(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const baseUrlRaw = (argValue("--base-url") || process.env.BILLING_SCHEDULER_BASE_URL || "").trim();
const secret = (process.env.BILLING_WORKER_SECRET || process.env.CRON_SECRET || "").trim();
const workerMs = positiveInt(process.env.BILLING_SCHEDULER_WORKER_MS, 60_000);
const reconcileMs = positiveInt(process.env.BILLING_SCHEDULER_RECONCILE_MS, 900_000);
const timeoutMs = positiveInt(process.env.BILLING_SCHEDULER_TIMEOUT_MS, 55_000);

if (!baseUrlRaw) {
  fail("Informe --base-url ou BILLING_SCHEDULER_BASE_URL.");
}

if (secret.length < 32 || secret.length > 255 || /\s/.test(secret)) {
  fail("Segredo do worker ausente ou fora da faixa de 32 a 255 caracteres.");
}

let baseUrl;

try {
  baseUrl = new URL(baseUrlRaw).origin;
} catch {
  fail("Base URL inválida.");
}

const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl);

if (!isLocal && !baseUrl.startsWith("https://")) {
  fail("Somente HTTPS (ou localhost) é permitido.");
}

const label = baseUrl.replace(/\/+$/, "");

function log(message) {
  console.log(`[billing:schedule] ${new Date().toISOString()} ${message}`);
}

async function call(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${label}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;

    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 200) };
    }

    const elapsed = Date.now() - startedAt;
    const summary = {
      status: response.status,
      elapsedMs: elapsed,
      ok: body?.ok ?? null,
      processed: body?.processed ?? body?.counts?.processed ?? null,
      deadLettered: body?.deadLettered ?? body?.counts?.deadLettered ?? null,
      failed: body?.failed ?? body?.counts?.failed ?? null,
      reconciled: body?.reconciled ?? body?.counts?.reconciled ?? null,
      divergences: body?.divergences ?? null,
      errors: body?.errors ?? null,
      error: body?.error ?? null,
    };

    log(`${path} ${JSON.stringify(summary)}`);
    return { status: response.status, body, ok: response.ok };
  } catch (error) {
    const reason = error?.name === "AbortError" ? "timeout" : "network_error";
    log(`${path} {"ok":false,"error":"${reason}"}`);
    return { status: 0, body: null, ok: false };
  } finally {
    clearTimeout(timer);
  }
}

let running = true;
let workerFailures = 0;
let reconcileFailures = 0;

function schedule(path, intervalMs, onResult) {
  let timer = null;

  const tick = async () => {
    const startedAt = Date.now();
    const result = await call(path);
    await onResult(result);
    if (running) {
      const elapsed = Date.now() - startedAt;
      timer = setTimeout(tick, Math.max(1_000, intervalMs - elapsed));
    }
  };

  tick();

  return () => {
    if (timer) clearTimeout(timer);
  };
}

log(
  `iniciado base=${label} worker=${workerMs}ms reconcile=${reconcileMs}ms timeout=${timeoutMs}ms`,
);

const stopWorker = schedule(WORKER_PATH, workerMs, (result) => {
  workerFailures = result.ok ? 0 : workerFailures + 1;
  if (workerFailures >= 3) {
    log(`ALERTA worker falhou ${workerFailures} vezes seguidas.`);
  }
});

const stopReconcile = schedule(RECONCILE_PATH, reconcileMs, (result) => {
  reconcileFailures = result.ok ? 0 : reconcileFailures + 1;
  if (reconcileFailures >= 2) {
    log(`ALERTA conciliação falhou ${reconcileFailures} vezes seguidas.`);
  }
});

const shutdown = (signal) => {
  if (!running) return;
  running = false;
  stopWorker();
  stopReconcile();
  log(`encerrando (${signal}).`);
  setTimeout(() => process.exit(0), 500);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
