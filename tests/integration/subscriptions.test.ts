import { createHash, randomUUID } from "node:crypto";

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
let clientAdmin: SupabaseClient;
let clientOwnerA: SupabaseClient;
let clientOwnerB: SupabaseClient;

const users: string[] = [];
const stores: string[] = [];

let storeA = "";
let storeB = "";
let slugA = "";
let slugB = "";
let planId = "";
let categoryA = "";
let productA = "";
let platformAdminId = "";
let ownerAId = "";
let ownerBId = "";
let orderNumber = 0;
let orderTokenHash = "";

let phoneSeq = 0;

function nextPhone(): string {
  phoneSeq += 1;
  return `119${String(20_000_000 + phoneSeq).padStart(8, "0")}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function newKey(): string {
  return randomUUID();
}

function newTokenHash(): string {
  return sha256(randomUUID());
}

function errorMessage(error: { message: string } | null): string {
  return error?.message ?? "";
}

function orderPayload(overrides: Record<string, unknown> = {}) {
  return {
    customerName: "Cliente Assinatura",
    customerPhone: nextPhone(),
    fulfillmentType: "delivery",
    address: {
      street: "Rua da Assinatura",
      number: "10",
      complement: "",
      district: "Centro",
      city: "São Paulo",
      reference: "",
      postalCode: "01000-000",
    },
    paymentMethod: "cash",
    notes: "",
    items: [{ productId: productA, quantity: 1, notes: "", options: [] }],
    ...overrides,
  };
}

function createOrder(
  slug: string,
  payload: Record<string, unknown>,
  key: string,
  tokenHash: string,
) {
  return anon.rpc("create_order", {
    p_store_slug: slug,
    p_payload: payload,
    p_idempotency_key: key,
    p_request_hash: sha256(JSON.stringify(payload)),
    p_tracking_token_hash: tokenHash,
  });
}

function createStoreAsAdmin(input: {
  name: string;
  slug: string;
  ownerUserId: string;
  startTrial: boolean;
  requestId?: string;
}) {
  return clientAdmin.rpc("admin_create_store", {
    p_name: input.name,
    p_slug: input.slug,
    p_description: null,
    p_phone: null,
    p_plan_id: planId,
    p_owner_user_id: input.ownerUserId,
    p_start_trial: input.startTrial,
    p_request_id: input.requestId ?? randomUUID(),
  });
}

function subscriptionState(storeId: string) {
  return clientAdmin.rpc("get_store_subscription", { p_store_id: storeId });
}

async function commercialStatus(slug: string) {
  const response = await anon.rpc("get_store_commercial_status", { p_store_slug: slug });
  return response.data as Record<string, unknown> | null;
}

describe.skipIf(!enabled)("assinaturas e acesso comercial (integração real)", () => {
  beforeAll(async () => {
    admin = createClient(url!, serviceRoleKey!, clientOptions);
    anon = createClient(url!, anonKey!, clientOptions);

    async function createUser(prefix: string) {
      const email = `subs-${prefix}-${runId}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: `Assinaturas ${prefix.toUpperCase()}` },
      });

      if (error || !data.user) {
        throw new Error(`createUser(${prefix}): ${error?.message ?? "erro desconhecido"}`);
      }

      users.push(data.user.id);
      return { id: data.user.id, email };
    }

    const adminUser = await createUser("admin");
    const ownerA = await createUser("owner-a");
    const ownerB = await createUser("owner-b");

    platformAdminId = adminUser.id;
    ownerAId = ownerA.id;
    ownerBId = ownerB.id;

    const { error: adminError } = await admin
      .from("platform_admins")
      .insert({ user_id: platformAdminId });

    if (adminError) {
      throw new Error(`platform admin: ${adminError.message}`);
    }

    async function signIn(email: string) {
      const client = createClient(url!, anonKey!, clientOptions);
      const { error } = await client.auth.signInWithPassword({ email, password });

      if (error) {
        throw new Error(`signIn(${email}): ${error.message}`);
      }

      return client;
    }

    clientAdmin = await signIn(adminUser.email);
    clientOwnerA = await signIn(ownerA.email);
    clientOwnerB = await signIn(ownerB.email);

    const { data: plan, error: planError } = await admin
      .from("plans")
      .select("id")
      .eq("code", "avdelivery")
      .single();

    if (planError || !plan) {
      throw new Error(`plano padrão: ${planError?.message ?? "não encontrado"}`);
    }

    planId = plan.id;
    slugA = `subs-a-${runId}`;
    slugB = `subs-b-${runId}`;

    const createdA = await createStoreAsAdmin({
      name: "Assinaturas Loja A",
      slug: slugA,
      ownerUserId: ownerAId,
      startTrial: true,
    });

    if (createdA.error || !createdA.data) {
      throw new Error(`criar loja A: ${errorMessage(createdA.error)}`);
    }

    storeA = String((createdA.data as Record<string, unknown>).storeId);

    const createdB = await createStoreAsAdmin({
      name: "Assinaturas Loja B",
      slug: slugB,
      ownerUserId: ownerBId,
      startTrial: false,
    });

    if (createdB.error || !createdB.data) {
      throw new Error(`criar loja B: ${errorMessage(createdB.error)}`);
    }

    storeB = String((createdB.data as Record<string, unknown>).storeId);
    stores.push(storeA, storeB);

    const { error: settingsError } = await admin
      .from("stores")
      .update({
        accepting_orders: true,
        delivery_enabled: true,
        pickup_enabled: true,
        delivery_fee_cents: 0,
        min_order_cents: 0,
        payment_pix_enabled: false,
        payment_cash_enabled: true,
        payment_card_on_delivery_enabled: false,
      })
      .in("id", [storeA, storeB]);

    if (settingsError) {
      throw new Error(`configurar lojas: ${settingsError.message}`);
    }

    const { data: category, error: categoryError } = await admin
      .from("categories")
      .insert({ store_id: storeA, name: "Assinatura", active: true })
      .select("id")
      .single();

    if (categoryError || !category) {
      throw new Error(`categoria: ${categoryError?.message ?? "sem dados"}`);
    }

    categoryA = category.id;

    const { data: product, error: productError } = await admin
      .from("products")
      .insert({
        store_id: storeA,
        category_id: categoryA,
        name: "Item da assinatura",
        price_cents: 1500,
        available: true,
      })
      .select("id")
      .single();

    if (productError || !product) {
      throw new Error(`produto: ${productError?.message ?? "sem dados"}`);
    }

    productA = product.id;
  }, 120_000);

  afterAll(async () => {
    if (!enabled || !admin) {
      return;
    }

    try {
      if (stores.length > 0) {
        await admin.from("orders").delete().in("store_id", stores);
        await admin.from("customers").delete().in("store_id", stores);
        await admin.from("products").delete().in("store_id", stores);
        await admin.from("categories").delete().in("store_id", stores);
        // Excluir a loja em cascata remove vínculos, assinatura e eventos.
        await admin.from("stores").delete().in("id", stores);
      }

      if (platformAdminId) {
        await admin.from("platform_admins").delete().eq("user_id", platformAdminId);
      }

      for (const userId of users) {
        await admin.auth.admin.deleteUser(userId);
      }
    } catch (error) {
      console.error(
        "[subscriptions.cleanup]",
        error instanceof Error ? error.message : "erro desconhecido",
      );
    }
  }, 120_000);

  it("cria a loja, a assinatura em teste e o vínculo do proprietário", async () => {
    const { data: subscription } = await admin
      .from("subscriptions")
      .select("id, status, is_exempt, trial_started_at, trial_ends_at, plan_id")
      .eq("store_id", storeA)
      .single();

    expect(subscription).toMatchObject({
      status: "trialing",
      is_exempt: false,
      plan_id: planId,
    });
    expect(subscription?.trial_started_at).toBeTruthy();
    expect(subscription?.trial_ends_at).toBeTruthy();

    const { data: membership } = await admin
      .from("store_memberships")
      .select("role")
      .eq("store_id", storeA)
      .eq("user_id", ownerAId)
      .single();

    expect(membership?.role).toBe("owner");

    const { data: event } = await admin
      .from("subscription_events")
      .select("event_type, actor_id, dedupe_key")
      .eq("store_id", storeA)
      .eq("event_type", "store_created")
      .single();

    expect(event).toMatchObject({ actor_id: platformAdminId });
    expect(event?.dedupe_key).toBeTruthy();
  });

  it("expõe a assinatura ao proprietário e nega acesso entre lojas", async () => {
    const ownerView = await subscriptionState(storeA);

    expect(ownerView.error).toBeNull();
    expect(ownerView.data).toMatchObject({ state: "trialing", hasAccess: true, isExempt: false });

    const crossTenant = await clientOwnerB.rpc("get_store_subscription", { p_store_id: storeA });

    expect(crossTenant.error).not.toBeNull();
    expect(errorMessage(crossTenant.error)).toContain("forbidden");

    const { data: leaked } = await clientOwnerB
      .from("subscriptions")
      .select("id")
      .eq("store_id", storeA);

    expect(leaked).toEqual([]);
  });

  it("não permite que o proprietário altere preço, status, datas ou eventos", async () => {
    const statusUpdate = await clientOwnerA
      .from("subscriptions")
      .update({ status: "active", is_exempt: true })
      .eq("store_id", storeA)
      .select("id");

    expect(statusUpdate.error).not.toBeNull();
    expect(statusUpdate.error?.code).toBe("42501");

    const invoiceInsert = await clientOwnerA.from("invoices").insert({
      store_id: storeA,
      subscription_id: randomUUID(),
      amount_cents: 1,
      currency: "BRL",
      status: "paid",
      period_start: new Date().toISOString(),
      period_end: new Date().toISOString(),
      due_at: new Date().toISOString(),
      paid_at: new Date().toISOString(),
    });

    expect(invoiceInsert.error).not.toBeNull();
    expect(invoiceInsert.error?.code).toBe("42501");

    const eventInsert = await clientOwnerA
      .from("subscription_events")
      .insert({ store_id: storeA, event_type: "forged_revenue" });

    expect(eventInsert.error).not.toBeNull();
    expect(eventInsert.error?.code).toBe("42501");
  });

  it("nega operações administrativas a quem não é superadministrador", async () => {
    const { error } = await clientOwnerA.rpc("admin_create_store", {
      p_name: "Loja proibida",
      p_slug: `subs-proibida-${runId}`,
      p_description: null,
      p_phone: null,
      p_plan_id: planId,
      p_owner_user_id: ownerAId,
      p_start_trial: true,
      p_request_id: randomUUID(),
    });

    expect(error).not.toBeNull();
    expect(errorMessage(error)).toContain("forbidden");

    const update = await clientOwnerA.rpc("admin_update_subscription", {
      p_store_id: storeA,
      p_action: "set_exempt",
      p_days: null,
      p_plan_id: null,
      p_reason: "tentativa indevida",
      p_request_id: randomUUID(),
    });

    expect(update.error).not.toBeNull();
    expect(errorMessage(update.error)).toContain("forbidden");

    const { error: listing } = await clientOwnerA.rpc("admin_list_store_billing");

    expect(listing).not.toBeNull();
    expect(errorMessage(listing)).toContain("forbidden");
  });

  it("mantém a criação idempotente e protege o slug contra concorrência", async () => {
    const requestId = randomUUID();
    const slug = `subs-idem-${runId}`;

    const first = await createStoreAsAdmin({
      name: "Loja idempotente",
      slug,
      ownerUserId: ownerAId,
      startTrial: true,
      requestId,
    });

    expect(first.error).toBeNull();
    expect((first.data as Record<string, unknown>).created).toBe(true);

    const retry = await createStoreAsAdmin({
      name: "Loja idempotente",
      slug,
      ownerUserId: ownerAId,
      startTrial: true,
      requestId,
    });

    expect(retry.error).toBeNull();
    expect(retry.data).toMatchObject({
      storeId: (first.data as Record<string, unknown>).storeId,
      created: false,
    });

    const conflicting = await createStoreAsAdmin({
      name: "Loja idempotente",
      slug: `${slug}-outro`,
      ownerUserId: ownerAId,
      startTrial: true,
      requestId,
    });

    expect(conflicting.error).not.toBeNull();
    expect(errorMessage(conflicting.error)).toContain("idempotency_conflict");

    const duplicateSlug = await createStoreAsAdmin({
      name: "Loja duplicada",
      slug,
      ownerUserId: ownerAId,
      startTrial: true,
    });

    expect(duplicateSlug.error).not.toBeNull();
    expect(errorMessage(duplicateSlug.error)).toContain("slug_taken");

    stores.push(String((first.data as Record<string, unknown>).storeId));

    const raceSlug = `subs-race-${runId}`;
    const [raceLeft, raceRight] = await Promise.all([
      createStoreAsAdmin({
        name: "Corrida esquerda",
        slug: raceSlug,
        ownerUserId: ownerAId,
        startTrial: true,
      }),
      createStoreAsAdmin({
        name: "Corrida direita",
        slug: raceSlug,
        ownerUserId: ownerAId,
        startTrial: true,
      }),
    ]);

    const failures = [raceLeft, raceRight].filter((result) => result.error);
    const successes = [raceLeft, raceRight].filter((result) => !result.error);

    expect(failures).toHaveLength(1);
    expect(successes).toHaveLength(1);
    expect(errorMessage(failures[0].error)).toContain("slug_taken");

    stores.push(String((successes[0].data as Record<string, unknown>).storeId));
  });

  it("cria pedido durante o teste e bloqueia apenas pedidos novos após o vencimento", async () => {
    const tokenHash = newTokenHash();
    const payload = orderPayload();
    const first = await createOrder(slugA, payload, newKey(), tokenHash);

    expect(first.error).toBeNull();
    const order = first.data as Record<string, unknown>;
    orderNumber = Number(order.orderNumber);
    orderTokenHash = tokenHash;

    const { data: storedOrder } = await admin
      .from("orders")
      .select("id, status")
      .eq("store_id", storeA)
      .eq("order_number", orderNumber)
      .single();

    expect(storedOrder?.status).toBe("pending");

    // Carência: o teste terminou ontem, mas o prazo de carência ainda vale.
    const graceStartedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const graceTrialEnd = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { error: graceFixtureError } = await admin
      .from("subscriptions")
      .update({ trial_started_at: graceStartedAt, trial_ends_at: graceTrialEnd })
      .eq("store_id", storeA);

    expect(graceFixtureError).toBeNull();

    const inGrace = await (await commercialStatus(slugA))!;
    expect(inGrace.state).toBe("grace");
    expect(inGrace.hasAccess).toBe(true);

    const duringGrace = await createOrder(slugA, orderPayload(), newKey(), newTokenHash());
    expect(duringGrace.error).toBeNull();

    // Teste e carência vencidos: bloqueio real no banco.
    const expiredStartedAt = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString();
    const expiredTrialEnd = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const { error: expiredFixtureError } = await admin
      .from("subscriptions")
      .update({ trial_started_at: expiredStartedAt, trial_ends_at: expiredTrialEnd })
      .eq("store_id", storeA);

    expect(expiredFixtureError).toBeNull();

    const expired = await (await commercialStatus(slugA))!;
    expect(expired.state).toBe("expired");
    expect(expired.hasAccess).toBe(false);

    const blocked = await createOrder(slugA, orderPayload(), newKey(), newTokenHash());
    expect(blocked.error).not.toBeNull();
    expect(errorMessage(blocked.error)).toContain("subscription_inactive");

    // O pedido aceito anteriormente continua preservado e consultável.
    const { data: preservedOrders } = await clientOwnerA
      .from("orders")
      .select("order_number, status")
      .eq("store_id", storeA)
      .order("order_number");

    expect(preservedOrders?.length).toBeGreaterThanOrEqual(2);
    expect(preservedOrders?.some((row) => row.order_number === orderNumber)).toBe(true);

    const tracking = await anon.rpc("get_order_tracking", {
      p_store_slug: slugA,
      p_order_number: orderNumber,
      p_tracking_token_hash: orderTokenHash,
    });

    expect(tracking.error).toBeNull();
    expect(tracking.data).not.toBeNull();
  });

  it("exige motivo e registra auditoria nas ações administrativas", async () => {
    const noReason = await clientAdmin.rpc("admin_update_subscription", {
      p_store_id: storeA,
      p_action: "activate",
      p_days: 30,
      p_plan_id: null,
      p_reason: "",
      p_request_id: randomUUID(),
    });

    expect(noReason.error).not.toBeNull();
    expect(errorMessage(noReason.error)).toContain("invalid_reason");

    const requestId = randomUUID();
    const activated = await clientAdmin.rpc("admin_update_subscription", {
      p_store_id: storeA,
      p_action: "activate",
      p_days: 30,
      p_plan_id: null,
      p_reason: "Regularização comercial de homologação.",
      p_request_id: requestId,
    });

    expect(activated.error).toBeNull();
    expect(activated.data).toMatchObject({ state: "active", changed: true });

    const retry = await clientAdmin.rpc("admin_update_subscription", {
      p_store_id: storeA,
      p_action: "activate",
      p_days: 30,
      p_plan_id: null,
      p_reason: "Regularização comercial de homologação.",
      p_request_id: requestId,
    });

    expect(retry.error).toBeNull();
    expect(retry.data).toMatchObject({ state: "active", changed: false });

    const { data: events } = await admin
      .from("subscription_events")
      .select("event_type, reason, actor_id")
      .eq("store_id", storeA)
      .eq("event_type", "admin_activate");

    expect(events).toHaveLength(1);
    expect(events?.[0]).toMatchObject({
      actor_id: platformAdminId,
      reason: "Regularização comercial de homologação.",
    });

    const afterRegularization = await (await commercialStatus(slugA))!;
    expect(afterRegularization.hasAccess).toBe(true);

    const restored = await createOrder(slugA, orderPayload(), newKey(), newTokenHash());
    expect(restored.error).toBeNull();
  });

  it("mantém o histórico imutável e impede faturas pagas sem pagamento", async () => {
    const { data: events } = await admin
      .from("subscription_events")
      .select("id")
      .eq("store_id", storeA)
      .limit(1);

    const eventId = events?.[0]?.id;

    const updateAttempt = await admin
      .from("subscription_events")
      .update({ reason: "adulterado" })
      .eq("id", eventId);

    expect(updateAttempt.error).not.toBeNull();
    expect(updateAttempt.error?.code).toBe("42501");

    const deleteAttempt = await admin.from("subscription_events").delete().eq("id", eventId);

    expect(deleteAttempt.error).not.toBeNull();
    expect(deleteAttempt.error?.code).toBe("42501");

    const { data: subscription } = await admin
      .from("subscriptions")
      .select("id")
      .eq("store_id", storeA)
      .single();

    const paidWithoutPaidAt = await admin.from("invoices").insert({
      store_id: storeA,
      subscription_id: subscription!.id,
      amount_cents: 5990,
      currency: "BRL",
      status: "paid",
      period_start: new Date().toISOString(),
      period_end: new Date().toISOString(),
      due_at: new Date().toISOString(),
      external_provider: "manual-test",
      external_reference: `paid-${runId}`,
    });

    expect(paidWithoutPaidAt.error).not.toBeNull();

    const duplicateCharges = await admin.from("invoices").insert([
      {
        store_id: storeA,
        subscription_id: subscription!.id,
        amount_cents: 5990,
        currency: "BRL",
        status: "pending",
        period_start: new Date().toISOString(),
        period_end: new Date().toISOString(),
        due_at: new Date().toISOString(),
        external_provider: "manual-test",
        external_reference: `dup-${runId}`,
      },
      {
        store_id: storeA,
        subscription_id: subscription!.id,
        amount_cents: 5990,
        currency: "BRL",
        status: "pending",
        period_start: new Date().toISOString(),
        period_end: new Date().toISOString(),
        due_at: new Date().toISOString(),
        external_provider: "manual-test",
        external_reference: `dup-${runId}`,
      },
    ]);

    expect(duplicateCharges.error).not.toBeNull();
  });

  it("preserva a isenção administrativa documentada e o último proprietário", async () => {
    const exempt = await clientAdmin.rpc("admin_update_subscription", {
      p_store_id: storeB,
      p_action: "set_exempt",
      p_days: null,
      p_plan_id: null,
      p_reason: "Loja de homologação isenta durante a transição.",
      p_request_id: randomUUID(),
    });

    expect(exempt.error).toBeNull();
    expect(exempt.data).toMatchObject({ state: "exempt" });

    const statusB = await commercialStatus(slugB);
    expect(statusB?.state).toBe("exempt");
    expect(statusB?.hasAccess).toBe(true);

    const { data: subscriptionB } = await admin
      .from("subscriptions")
      .select("is_exempt, exemption_reason")
      .eq("store_id", storeB)
      .single();

    expect(subscriptionB).toMatchObject({
      is_exempt: true,
      exemption_reason: "Loja de homologação isenta durante a transição.",
    });

    const { error: removeOwner } = await admin
      .from("store_memberships")
      .delete()
      .eq("store_id", storeB)
      .eq("user_id", ownerBId);

    expect(removeOwner).not.toBeNull();

    const { data: stillOwner } = await admin
      .from("store_memberships")
      .select("role")
      .eq("store_id", storeB)
      .eq("user_id", ownerBId)
      .maybeSingle();

    expect(stillOwner?.role).toBe("owner");
  });

  it("lista métricas comerciais somente para o superadministrador", async () => {
    const { data, error } = await clientAdmin.rpc("admin_list_store_billing");

    expect(error).toBeNull();

    const rows = (data ?? []) as Record<string, unknown>[];
    const rowA = rows.find((row) => row.store_id === storeA);
    const rowB = rows.find((row) => row.store_id === storeB);

    expect(rowA).toMatchObject({ slug: slugA, effective_state: "active" });
    expect(rowB).toMatchObject({ slug: slugB, effective_state: "exempt", is_exempt: true });
  });
});
