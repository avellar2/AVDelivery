import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.SUPABASE_TEST_URL?.trim();
const anonKey = process.env.SUPABASE_TEST_ANON_KEY?.trim();
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY?.trim();
const enabled = Boolean(url && anonKey && serviceRoleKey);

const password = "Teste-forte-123";
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };

let admin: SupabaseClient;
let anon: SupabaseClient;
let ownerClient: SupabaseClient;
let platformClient: SupabaseClient;

const createdEventIds: string[] = [];
const createdUserIds: string[] = [];
const createdJobRunIds: string[] = [];
const shiftedBacklog = new Map<string, string>();
let platformAdminId = "";

type InboxRow = {
  id: string;
  external_event_id: string;
  status: string;
  attempts: number;
  lease_token: string | null;
};

type ClaimedRow = InboxRow & {
  lease_token: string;
  payload: Record<string, unknown>;
};

type FailResult = {
  status: string;
  already: boolean;
  deadLettered: boolean;
  nextAttemptAt: string | null;
};

function eventId(suffix: string): string {
  return `evt-rel-${runId}-${suffix}`;
}

function receive(suffix: string, payload: Record<string, unknown> = {}) {
  return admin.rpc("billing_receive_webhook_event", {
    p_provider: "asaas",
    p_external_event_id: eventId(suffix),
    p_event_type: "PAYMENT_CONFIRMED",
    p_resource_type: "payment",
    p_resource_id: `pay-${suffix}`,
    p_payload: { id: eventId(suffix), payment: { id: `pay-${suffix}` }, ...payload },
  });
}

async function receiveTracked(suffix: string, payload: Record<string, unknown> = {}) {
  const result = await receive(suffix, payload);

  if (result.error || !result.data) {
    throw new Error(`receive(${suffix}): ${result.error?.message ?? "sem dados"}`);
  }

  const row = result.data as InboxRow;
  createdEventIds.push(row.id);
  return row;
}

async function claim(limit = 50, leaseSeconds = 60): Promise<ClaimedRow[]> {
  const { data, error } = await admin.rpc("billing_claim_webhook_events", {
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    throw new Error(`claim: ${error.message}`);
  }

  return (data ?? []) as ClaimedRow[];
}

function ours(rows: ClaimedRow[]): ClaimedRow[] {
  return rows.filter((row) => createdEventIds.includes(row.id));
}

async function inbox(id: string): Promise<InboxRow> {
  const { data, error } = await admin
    .from("billing_webhook_events")
    .select("id, external_event_id, status, attempts, lease_token")
    .eq("id", id)
    .single();

  if (error || !data) {
    throw new Error(`inbox(${id}): ${error?.message ?? "ausente"}`);
  }

  return data as InboxRow;
}

async function signIn(email: string) {
  const client = createClient(url!, anonKey!, clientOptions);
  const { error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    throw new Error(`signIn: ${error.message}`);
  }

  return client;
}

async function createUser(prefix: string) {
  const email = `billing-rel-${prefix}-${runId}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: `Billing rel ${prefix}` },
  });

  if (error || !data.user) {
    throw new Error(`createUser(${prefix}): ${error?.message ?? "sem usuário"}`);
  }

  createdUserIds.push(data.user.id);
  return { id: data.user.id, email };
}

describe.skipIf(!enabled)("inbox durável, leases e observabilidade (integração real)", () => {
  beforeAll(async () => {
    admin = createClient(url!, serviceRoleKey!, clientOptions);
    anon = createClient(url!, anonKey!, clientOptions);

    const owner = await createUser("owner");
    const platform = await createUser("admin");
    platformAdminId = platform.id;

    const { error } = await admin.from("platform_admins").insert({ user_id: platformAdminId });

    if (error) {
      throw new Error(`platform admin: ${error.message}`);
    }

    ownerClient = await signIn(owner.email);
    platformClient = await signIn(platform.email);

    // Keep unrelated homologation events out of the claim window so this suite
    // only observes the rows it created. The original schedule is restored in
    // afterAll; no event is deleted or marked as done.
    const { data: backlog, error: backlogError } = await admin
      .from("billing_webhook_events")
      .select("id, next_attempt_at")
      .in("status", ["received", "failed"]);

    if (backlogError) {
      throw new Error(`backlog: ${backlogError.message}`);
    }

    const future = new Date(Date.now() + 60 * 60_000).toISOString();

    for (const row of backlog ?? []) {
      shiftedBacklog.set(row.id, row.next_attempt_at);
    }

    if (shiftedBacklog.size > 0) {
      const { error: shiftError } = await admin
        .from("billing_webhook_events")
        .update({ next_attempt_at: future })
        .in("id", [...shiftedBacklog.keys()]);

      if (shiftError) {
        throw new Error(`adiar backlog: ${shiftError.message}`);
      }
    }
  }, 120_000);

  afterAll(async () => {
    if (!enabled || !admin) {
      return;
    }

    try {
      if (createdEventIds.length > 0) {
        await admin.from("billing_webhook_events").delete().in("id", createdEventIds);
      }

      if (createdJobRunIds.length > 0) {
        await admin.from("billing_job_runs").delete().in("id", createdJobRunIds);
      }

      for (const [id, nextAttemptAt] of shiftedBacklog) {
        await admin
          .from("billing_webhook_events")
          .update({ next_attempt_at: nextAttemptAt })
          .eq("id", id);
      }

      if (platformAdminId) {
        await admin.from("platform_admins").delete().eq("user_id", platformAdminId);
      }

      for (const userId of createdUserIds) {
        await admin.auth.admin.deleteUser(userId);
      }
    } catch (error) {
      console.error(
        "[billing-reliability.cleanup]",
        error instanceof Error ? error.message : "erro desconhecido",
      );
    }
  }, 120_000);

  it("persiste o evento uma única vez e devolve a mesma linha na duplicata", async () => {
    const first = await receiveTracked("dedupe", { payment: { id: "pay-dedupe", version: 1 } });
    expect(first).toMatchObject({ status: "received", attempts: 0, duplicate: false });

    const duplicate = await receive("dedupe", { payment: { id: "pay-dedupe", version: 2 } });
    expect(duplicate.error).toBeNull();
    expect(duplicate.data).toMatchObject({
      id: first.id,
      status: "received",
      attempts: 0,
      duplicate: true,
    });

    const { data: stored } = await admin
      .from("billing_webhook_events")
      .select("payload")
      .eq("id", first.id)
      .single();
    expect((stored?.payload as { payment: { version: number } }).payment.version).toBe(1);

    const { count } = await admin
      .from("billing_webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("external_event_id", eventId("dedupe"));
    expect(count).toBe(1);
  });

  it("rejeita envelope inválido sem criar linha", async () => {
    const badProvider = await admin.rpc("billing_receive_webhook_event", {
      p_provider: "outro",
      p_external_event_id: eventId("bad-provider"),
      p_event_type: "PAYMENT_CONFIRMED",
      p_resource_type: "payment",
      p_resource_id: "pay",
      p_payload: {},
    });
    expect(badProvider.error?.message).toContain("invalid_provider");

    const shortId = await admin.rpc("billing_receive_webhook_event", {
      p_provider: "asaas",
      p_external_event_id: "x",
      p_event_type: "PAYMENT_CONFIRMED",
      p_resource_type: "payment",
      p_resource_id: "pay",
      p_payload: {},
    });
    expect(shortId.error?.message).toContain("invalid_event_id");

    const badResource = await admin.rpc("billing_receive_webhook_event", {
      p_provider: "asaas",
      p_external_event_id: eventId("bad-resource"),
      p_event_type: "PAYMENT_CONFIRMED",
      p_resource_type: "customer",
      p_resource_id: "cus",
      p_payload: {},
    });
    expect(badResource.error?.message).toContain("invalid_resource_type");
  });

  it("reivindica cada evento para um único worker, mesmo em paralelo", async () => {
    const created = await Promise.all(
      ["c1", "c2", "c3", "c4", "c5", "c6"].map((suffix) => receiveTracked(suffix)),
    );

    const [first, second] = await Promise.all([claim(), claim()]);
    const targetIds = new Set(created.map((row) => row.id));
    const claimed = ours([...first, ...second]).filter((row) => targetIds.has(row.id));
    const ids = claimed.map((row) => row.id);

    expect(claimed).toHaveLength(created.length);
    expect(new Set(ids).size).toBe(created.length);
    expect(new Set(ids)).toEqual(targetIds);
    expect(new Set(ids).size).toBe(ids.length);

    for (const row of claimed) {
      expect(row.attempts).toBe(1);
      expect(row.lease_token).toBeTruthy();

      const stored = await inbox(row.id);
      expect(stored).toMatchObject({
        status: "processing",
        attempts: 1,
        lease_token: row.lease_token,
      });
    }

    for (const row of claimed) {
      const { error } = await admin.rpc("billing_complete_webhook_event", {
        p_id: row.id,
        p_lease_token: row.lease_token,
        p_outcome: "processed",
        p_detail: null,
      });
      expect(error).toBeNull();
    }

    for (const row of claimed) {
      const stored = await inbox(row.id);
      expect(stored).toMatchObject({ status: "processed", attempts: 1, lease_token: null });
    }
  });

  it("exige o lease correto e não conta a tentativa duas vezes ao concluir", async () => {
    const row = await receiveTracked("lease");
    const claimed = ours(await claim()).find((entry) => entry.id === row.id);

    if (!claimed) {
      throw new Error("evento de lease não reivindicado");
    }

    const wrong = await admin.rpc("billing_complete_webhook_event", {
      p_id: row.id,
      p_lease_token: randomUUID(),
      p_outcome: "processed",
      p_detail: null,
    });
    expect(wrong.error?.message).toContain("lease_mismatch");

    const invalidOutcome = await admin.rpc("billing_complete_webhook_event", {
      p_id: row.id,
      p_lease_token: claimed.lease_token,
      p_outcome: "paid",
      p_detail: null,
    });
    expect(invalidOutcome.error?.message).toContain("invalid_outcome");

    const done = await admin.rpc("billing_complete_webhook_event", {
      p_id: row.id,
      p_lease_token: claimed.lease_token,
      p_outcome: "ignored",
      p_detail: "unsupported_event",
    });
    expect(done.error).toBeNull();
    expect(done.data).toMatchObject({ status: "ignored", already: false });

    const again = await admin.rpc("billing_complete_webhook_event", {
      p_id: row.id,
      p_lease_token: claimed.lease_token,
      p_outcome: "processed",
      p_detail: null,
    });
    expect(again.error).toBeNull();
    expect(again.data).toMatchObject({ status: "ignored", already: true });

    const stored = await inbox(row.id);
    expect(stored).toMatchObject({ status: "ignored", attempts: 1, lease_token: null });
  });

  it("reagenda falha transitória e só permite nova tentativa após o atraso", async () => {
    const row = await receiveTracked("retry");
    const claimed = ours(await claim()).find((entry) => entry.id === row.id);

    if (!claimed) {
      throw new Error("evento de retry não reivindicado");
    }

    const failed = await admin.rpc("billing_fail_webhook_event", {
      p_id: row.id,
      p_lease_token: claimed.lease_token,
      p_reason: "asaas_timeout",
      p_retryable: true,
      p_delay_seconds: 30,
      p_max_attempts: 8,
    });

    expect(failed.error).toBeNull();
    const result = failed.data as FailResult;
    expect(result).toMatchObject({ status: "failed", deadLettered: false });
    expect(result.nextAttemptAt).toBeTruthy();
    expect(new Date(result.nextAttemptAt!).getTime()).toBeGreaterThan(Date.now());

    const stored = await inbox(row.id);
    expect(stored).toMatchObject({ status: "failed", attempts: 1, lease_token: null });

    const immediate = ours(await claim());
    expect(immediate.find((entry) => entry.id === row.id)).toBeUndefined();

    await admin
      .from("billing_webhook_events")
      .update({ next_attempt_at: new Date().toISOString() })
      .eq("id", row.id);

    const retried = ours(await claim());
    expect(retried.find((entry) => entry.id === row.id)?.attempts).toBe(2);
  });

  it("envia falha permanente e tentativas esgotadas para dead letter", async () => {
    const permanent = await receiveTracked("permanent");
    const claimed = ours(await claim()).find((entry) => entry.id === permanent.id);

    if (!claimed) {
      throw new Error("evento permanente não reivindicado");
    }

    const rejected = await admin.rpc("billing_fail_webhook_event", {
      p_id: permanent.id,
      p_lease_token: claimed.lease_token,
      p_reason: "amount_mismatch",
      p_retryable: false,
      p_delay_seconds: 0,
      p_max_attempts: 8,
    });
    expect(rejected.error).toBeNull();
    expect(rejected.data).toMatchObject({ status: "dead_letter", deadLettered: true });

    const dead = await inbox(permanent.id);
    expect(dead).toMatchObject({ status: "dead_letter", lease_token: null });

    const { data: deadRow } = await admin
      .from("billing_webhook_events")
      .select("dead_lettered_at, last_error, processed_at")
      .eq("id", permanent.id)
      .single();
    expect(deadRow?.dead_lettered_at).toBeTruthy();
    expect(deadRow?.last_error).toBe("amount_mismatch");
    expect(deadRow?.processed_at).toBeNull();

    const exhausted = await receiveTracked("exhausted");
    const exhaustedClaim = ours(await claim()).find((entry) => entry.id === exhausted.id);

    if (!exhaustedClaim) {
      throw new Error("evento esgotado não reivindicado");
    }

    const { error: attemptError } = await admin
      .from("billing_webhook_events")
      .update({ attempts: 8 })
      .eq("id", exhausted.id);
    expect(attemptError).toBeNull();

    const lastTry = await admin.rpc("billing_fail_webhook_event", {
      p_id: exhausted.id,
      p_lease_token: exhaustedClaim.lease_token,
      p_reason: "attempts_exhausted:asaas_timeout",
      p_retryable: true,
      p_delay_seconds: 30,
      p_max_attempts: 8,
    });
    expect(lastTry.error).toBeNull();
    expect(lastTry.data).toMatchObject({ status: "dead_letter", deadLettered: true });
  });

  it("recupera lease expirado e encerra o que já esgotou tentativas", async () => {
    const recoverable = await receiveTracked("recover");
    const claimed = ours(await claim()).find((entry) => entry.id === recoverable.id);

    if (!claimed) {
      throw new Error("evento recuperável não reivindicado");
    }

    await admin
      .from("billing_webhook_events")
      .update({ lease_expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", recoverable.id);

    const recovered = await admin.rpc("billing_recover_stale_webhook_events", {
      p_max_attempts: 8,
    });
    expect(recovered.error).toBeNull();
    expect(recovered.data).toMatchObject({ recovered: expect.any(Number) });

    expect(await inbox(recoverable.id)).toMatchObject({
      status: "failed",
      attempts: 1,
      lease_token: null,
    });

    const exhausted = await receiveTracked("recover-dead");
    const exhaustedClaim = ours(await claim()).find((entry) => entry.id === exhausted.id);

    if (!exhaustedClaim) {
      throw new Error("evento expirado não reivindicado");
    }

    await admin
      .from("billing_webhook_events")
      .update({
        lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
        attempts: 8,
      })
      .eq("id", exhausted.id);

    const dead = await admin.rpc("billing_recover_stale_webhook_events", { p_max_attempts: 8 });
    expect(dead.error).toBeNull();

    expect(await inbox(exhausted.id)).toMatchObject({
      status: "dead_letter",
      attempts: 8,
      lease_token: null,
    });
  });

  it("bloqueia os RPCs internos para usuários comuns e preserva o estado terminal", async () => {
    const forbidden = await ownerClient.rpc("billing_claim_webhook_events", {
      p_limit: 1,
      p_lease_seconds: 60,
    });
    expect(forbidden.error).not.toBeNull();
    expect(forbidden.error?.message.toLowerCase()).toContain("permission denied");

    const forbiddenReceive = await ownerClient.rpc("billing_receive_webhook_event", {
      p_provider: "asaas",
      p_external_event_id: eventId("forbidden"),
      p_event_type: "PAYMENT_CONFIRMED",
      p_resource_type: "payment",
      p_resource_id: "pay",
      p_payload: {},
    });
    expect(forbiddenReceive.error).not.toBeNull();
    expect(forbiddenReceive.error?.message.toLowerCase()).toContain("permission denied");

    const row = await receiveTracked("terminal");
    const claimed = ours(await claim()).find((entry) => entry.id === row.id);

    if (!claimed) {
      throw new Error("evento terminal não reivindicado");
    }

    await admin.rpc("billing_complete_webhook_event", {
      p_id: row.id,
      p_lease_token: claimed.lease_token,
      p_outcome: "processed",
      p_detail: null,
    });

    const lateFailure = await admin.rpc("billing_fail_webhook_event", {
      p_id: row.id,
      p_lease_token: claimed.lease_token,
      p_reason: "late_error",
      p_retryable: false,
      p_delay_seconds: 30,
      p_max_attempts: 8,
    });
    expect(lateFailure.error).toBeNull();
    expect(lateFailure.data).toMatchObject({ status: "processed", already: true });

    const lateDuplicate = await receive("terminal", { late: true });
    expect(lateDuplicate.error).toBeNull();
    expect(lateDuplicate.data).toMatchObject({
      id: row.id,
      status: "processed",
      duplicate: true,
    });

    expect(await inbox(row.id)).toMatchObject({ status: "processed", attempts: 1 });
  });

  it("registra job runs apenas para o service role", async () => {
    const { data, error } = await admin
      .from("billing_job_runs")
      .insert({ job_name: "webhook_processor", status: "running" })
      .select("id")
      .single();

    expect(error).toBeNull();
    createdJobRunIds.push(data!.id);

    const { error: finishError } = await admin
      .from("billing_job_runs")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        claimed: 2,
        processed: 1,
        ignored: 1,
        errors: 0,
      })
      .eq("id", data!.id);
    expect(finishError).toBeNull();

    const read = await ownerClient.from("billing_job_runs").select("id");
    expect(read.error).not.toBeNull();
    const anonRead = await anon.from("billing_job_runs").select("id");
    expect(anonRead.error).not.toBeNull();
    const ownerWrite = await ownerClient
      .from("billing_job_runs")
      .insert({ job_name: "reconciliation", status: "running" });
    expect(ownerWrite.error).not.toBeNull();
  });

  it("expõe saúde somente para superadmin e sem payload ou PII", async () => {
    const healthResult = await platformClient.rpc("admin_get_billing_health");
    expect(healthResult.error).toBeNull();

    const forbidden = await ownerClient.rpc("admin_get_billing_health");
    expect(forbidden.error?.message).toContain("forbidden");

    const anonymous = await anon.rpc("admin_get_billing_health");
    expect(anonymous.error).not.toBeNull();

    const health = healthResult.data as Record<string, unknown>;
    expect(health).toMatchObject({
      pending: expect.any(Number),
      staleProcessing: expect.any(Number),
      deadLetter: expect.any(Number),
      statusCounts: expect.any(Object),
      alerts: expect.any(Array),
    });
    expect(health).toHaveProperty("lastWorkerRun");
    expect(health).toHaveProperty("lastReconciliationRun");

    const serialized = JSON.stringify(health);
    expect(serialized).not.toContain("payload");
    expect(serialized).not.toContain("documento");
    expect(serialized).not.toContain("cpf");
  });
});
