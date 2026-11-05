#!/usr/bin/env node
/**
 * Rerunnable Asaas Sandbox reconciliation.
 *
 * Reads subscriptions already linked to AVDelivery, fetches the authoritative
 * subscription and payments from Asaas, and applies each payment through the
 * same idempotent RPC used by webhooks. It never marks an invoice paid without
 * a provider payment, never activates access directly, and never invents a
 * scheduler: run it manually or from an external cron.
 *
 * Usage: npm run billing:reconcile [-- --dry-run]
 */
import { createClient } from "@supabase/supabase-js";

const SANDBOX_BASE_URL = "https://api-sandbox.asaas.com/v3";
const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = Math.min(100, Math.max(1, Number(process.env.BILLING_RECONCILE_LIMIT) || 25));

function fail(message) {
  console.error(`[billing:reconcile] ${message}`);
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
// `.env.local` escapes the leading `$` of Asaas keys so Next.js does not
// interpolate it as an environment variable. Node's --env-file preserves the
// backslash, so the CLI normalizes it back before calling the provider.
const apiKeyRaw = process.env.ASAAS_API_KEY?.trim() || "";
const apiKey = apiKeyRaw[0] === "\\" && apiKeyRaw[1] === "$" ? apiKeyRaw.slice(1) : apiKeyRaw;
const environment = (process.env.ASAAS_ENVIRONMENT?.trim() || "sandbox").toLowerCase();
const baseUrl = (process.env.ASAAS_BASE_URL?.trim() || SANDBOX_BASE_URL).replace(/\/+$/, "");
const userAgent = process.env.ASAAS_USER_AGENT?.trim() || "AVDelivery/1.0";

if (!supabaseUrl || !serviceRoleKey) {
  fail("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
}

if (!apiKey) {
  fail("ASAAS_API_KEY ausente. A conciliação não inventa credenciais.");
}

if (environment !== "sandbox") {
  fail("Somente o ambiente Sandbox é permitido.");
}

if (baseUrl !== SANDBOX_BASE_URL) {
  fail(`Somente ${SANDBOX_BASE_URL} é permitido. Produção é proibida.`);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const appliedPaymentIds = new Set();
let jobRunId = null;
let reconciled = 0;
let skipped = 0;
let divergences = 0;
let errors = 0;
let orphanPaymentIds = [];
let candidateCount = 0;

const FINANCIAL_DIVERGENCES = [
  "amount_mismatch",
  "currency_mismatch",
  "external_customer_mismatch",
  "invalid_payment_status",
];

async function startJobRun() {
  if (DRY_RUN) return;

  const { data, error } = await supabase
    .from("billing_job_runs")
    .insert({ job_name: "reconciliation", status: "running" })
    .select("id")
    .single();

  if (error) {
    console.warn(`[billing:reconcile] job run não registrado: ${error.message.split("|")[0]}`);
    return;
  }

  jobRunId = data?.id ?? null;
}

async function finishJobRun(status) {
  if (!jobRunId) return;

  const { error } = await supabase
    .from("billing_job_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      reconciled,
      divergences,
      errors,
      error: errors > 0 ? "reconciliation_errors" : null,
      metadata: {
        candidates: candidateCount,
        orphans: orphanPaymentIds.length,
        orphanPaymentIds: orphanPaymentIds.slice(0, 25),
        dryRun: DRY_RUN,
      },
    })
    .eq("id", jobRunId);

  if (error) {
    console.warn(`[billing:reconcile] job run não finalizado: ${error.message.split("|")[0]}`);
  }
}

async function asaas(path, attempt = 0) {
  let response;

  try {
    response = await fetch(`${SANDBOX_BASE_URL}${path}`, {
      headers: {
        access_token: apiKey,
        Accept: "application/json",
        "User-Agent": userAgent,
      },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    if (attempt < 2) {
      await sleep(300 * 2 ** attempt);
      return asaas(path, attempt + 1);
    }

    throw new Error("Falha de rede ao consultar o Asaas Sandbox.");
  }

  if ((response.status === 429 || response.status >= 500) && attempt < 2) {
    const retryAfter = Number(response.headers.get("retry-after"));
    await sleep(
      Number.isFinite(retryAfter) ? Math.min(8_000, retryAfter * 1_000) : 300 * 2 ** attempt,
    );
    return asaas(path, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`Asaas respondeu HTTP ${response.status} em ${path.split("?")[0]}.`);
  }

  return response.json();
}

const PAID = new Set(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH", "DUNNING_RECEIVED"]);
const REFUNDED = new Set([
  "REFUNDED",
  "REFUND_REQUESTED",
  "REFUND_IN_PROGRESS",
  "RECEIVED_IN_CASH_UNDONE",
  "AWAITING_PAYMENT_REVERSAL",
]);
const CHARGEBACK = new Set([
  "CHARGEBACK_REQUESTED",
  "CHARGEBACK_DISPUTE",
  "AWAITING_CHARGEBACK_REVERSAL",
]);
const PENDING = new Set([
  "PENDING",
  "AWAITING_RISK_ANALYSIS",
  "APPROVED_BY_RISK_ANALYSIS",
  "AUTHORIZED",
  "AWAITING_CAPTURE",
]);

function canonicalStatus(payment) {
  if (payment.deleted) {
    return "DELETED";
  }

  const status = String(payment.status || "")
    .trim()
    .toUpperCase();

  if (PAID.has(status)) return "CONFIRMED";
  if (status === "OVERDUE" || status === "DUNNING_REQUESTED") return "OVERDUE";
  if (REFUNDED.has(status)) return "REFUNDED";
  if (CHARGEBACK.has(status)) return "CHARGEBACK_REQUESTED";
  if (status === "DELETED" || status === "REPROVED_BY_RISK_ANALYSIS") return "DELETED";
  if (PENDING.has(status)) return "PENDING";

  return null;
}

function providerTimestamp(value) {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00-03:00` : value;
}

function safePaymentUrl(payment) {
  const candidate = payment.invoiceUrl || payment.bankSlipUrl || "";

  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "asaas.com" && !url.hostname.endsWith(".asaas.com")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function billingType(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return ["PIX", "BOLETO", "CREDIT_CARD", "UNDEFINED"].includes(normalized) ? normalized : null;
}

async function applyPayment(payment) {
  if (!payment.subscription) return "skipped";
  if (!payment.customer) return "skipped";
  if (appliedPaymentIds.has(payment.id)) return "skipped";

  const status = canonicalStatus(payment);
  if (!status) return "skipped";

  const amountCents = Math.round(Number(payment.value) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return "skipped";

  appliedPaymentIds.add(payment.id);

  if (DRY_RUN) return "would_apply";

  const { error } = await supabase.rpc("billing_apply_payment_event", {
    p_provider: "asaas",
    p_event_id: null,
    p_event_type: "RECONCILIATION",
    p_payment_id: payment.id,
    p_external_subscription_id: payment.subscription,
    p_external_customer_id: payment.customer,
    p_external_status: status,
    p_amount_cents: amountCents,
    p_currency: "BRL",
    p_due_date: payment.dueDate,
    p_paid_at: providerTimestamp(
      payment.confirmedDate || payment.paymentDate || payment.clientPaymentDate,
    ),
    p_payment_url: safePaymentUrl(payment),
    p_billing_type: billingType(payment.billingType),
    p_payload: { source: "reconciliation", paymentId: payment.id },
  });

  if (error) {
    const reason = error.message.split("|")[0];

    if (FINANCIAL_DIVERGENCES.some((divergence) => reason.includes(divergence))) {
      divergences += 1;
      console.error(`[billing:reconcile] divergência ${payment.id}: ${reason}`);
      return "divergence";
    }

    throw new Error(`RPC billing_apply_payment_event falhou: ${reason}`);
  }

  return status === "CONFIRMED" ? "paid_applied" : "state_applied";
}

async function reconcileSubscription(row) {
  const subscription = await asaas(
    `/subscriptions/${encodeURIComponent(row.external_subscription_id)}`,
  );
  const payments = await asaas(
    `/subscriptions/${encodeURIComponent(subscription.id)}/payments?limit=30&offset=0`,
  );
  const scoped = (payments.data || []).filter(
    (payment) => payment.subscription === subscription.id,
  );

  let paid = 0;
  let states = 0;
  let localSkipped = 0;

  for (const payment of scoped) {
    try {
      const result = await applyPayment(payment);

      if (result === "paid_applied") paid += 1;
      else if (result === "state_applied" || result === "would_apply") states += 1;
      else localSkipped += 1;
    } catch (error) {
      errors += 1;
      console.error(
        `[billing:reconcile] loja ${row.store_id}: ${error instanceof Error ? error.message : "erro"}`,
      );
      process.exitCode = 1;
    }
  }

  skipped += localSkipped;
  reconciled += paid + states;

  if (!DRY_RUN) {
    const { error } = await supabase.rpc("billing_update_external_subscription_status", {
      p_external_subscription_id: subscription.id,
      p_external_status: subscription.status,
      p_event_id: null,
      p_payload: { source: "reconciliation" },
    });

    if (error) {
      throw new Error(`Falha ao atualizar status externo: ${error.message.split("|")[0]}`);
    }
  }

  return { paid, states, skipped: localSkipped, seen: scoped.length, status: subscription.status };
}

/**
 * Compares the provider's most recent payments with local subscriptions.
 *
 * Payments for a known subscription are applied through the same idempotent
 * RPC, which recovers a confirmation whose webhook was lost. Payments for an
 * unknown subscription are reported as orphan external charges and never
 * attached to a store automatically.
 */
async function scanRecentPayments() {
  if (DRY_RUN) return;

  let payments;

  try {
    payments = await asaas("/payments?limit=100&offset=0");
  } catch (error) {
    errors += 1;
    console.error(
      `[billing:reconcile] varredura de pagamentos: ${error instanceof Error ? error.message : "erro"}`,
    );
    return;
  }

  const recent = payments.data || [];
  const externalIds = [
    ...new Set(
      recent
        .map((payment) => payment.subscription)
        .filter((value) => typeof value === "string" && value.length > 0),
    ),
  ];

  if (externalIds.length === 0) return;

  const { data: local, error } = await supabase
    .from("subscriptions")
    .select("external_subscription_id")
    .in("external_subscription_id", externalIds);

  if (error) {
    errors += 1;
    console.error(`[billing:reconcile] assinaturas locais: ${error.message.split("|")[0]}`);
    return;
  }

  const known = new Set(
    (local || [])
      .map((row) => row.external_subscription_id)
      .filter((value) => typeof value === "string" && value.length > 0),
  );

  orphanPaymentIds = externalIds.filter((id) => !known.has(id));

  for (const payment of recent) {
    if (!payment.subscription || !known.has(payment.subscription)) continue;
    if (appliedPaymentIds.has(payment.id)) continue;

    try {
      const result = await applyPayment(payment);

      if (result === "paid_applied" || result === "state_applied") reconciled += 1;
      else if (result === "skipped" || result === "would_apply") skipped += 1;
    } catch (error) {
      errors += 1;
      console.error(
        `[billing:reconcile] pagamento recente ${payment.id}: ${
          error instanceof Error ? error.message : "erro"
        }`,
      );
      process.exitCode = 1;
    }
  }

  if (orphanPaymentIds.length > 0) {
    console.warn(
      `[billing:reconcile] ${orphanPaymentIds.length} assinatura(s) externa(s) sem vínculo local; revisão manual necessária.`,
    );
  }
}

async function main() {
  await startJobRun();

  const { data: candidates, error } = await supabase.rpc("billing_reconciliation_candidates", {
    p_limit: LIMIT,
  });

  if (error) {
    errors += 1;
    await finishJobRun("failed");
    fail(`Não foi possível listar candidatos: ${error.message.split("|")[0]}`);
  }

  const rows = candidates || [];
  candidateCount = rows.length;
  console.log(
    `[billing:reconcile] ${DRY_RUN ? "simulação" : "execução"}: ${rows.length} assinatura(s), limite ${LIMIT}.`,
  );

  for (const row of rows) {
    try {
      const result = await reconcileSubscription(row);
      console.log(
        `[billing:reconcile] loja ${row.store_id}: ${result.seen} cobrança(s), ${result.paid} paga(s), ${result.states} estado(s), ${result.skipped} ignorada(s), status ${result.status}.`,
      );
    } catch (error) {
      errors += 1;
      process.exitCode = 1;
      console.error(
        `[billing:reconcile] loja ${row.store_id}: ${error instanceof Error ? error.message : "erro"}`,
      );
    }

    await sleep(150);
  }

  await scanRecentPayments();

  let status = "succeeded";

  if (errors > 0) {
    status = reconciled > 0 ? "partial" : "failed";
  } else if (divergences > 0 || orphanPaymentIds.length > 0) {
    status = "partial";
  }

  await finishJobRun(status);

  console.log(
    `[billing:reconcile] concluído (${status}): ${reconciled} pagamento(s)/estado(s) aplicado(s), ${skipped} ignorado(s), ${divergences} divergência(s), ${errors} erro(s), ${orphanPaymentIds.length} assinatura(s) externa(s) órfã(s).`,
  );
}

main().catch(async (error) => {
  await finishJobRun("failed");
  fail(error instanceof Error ? error.message : "erro inesperado");
});
