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
let platformClient: SupabaseClient;
let ownerAClient: SupabaseClient;
let ownerBClient: SupabaseClient;

const userIds: string[] = [];
const storeIds: string[] = [];

let storeA = "";
let storeB = "";
let platformAdminId = "";
let priceCents = 0;
let dueDate = "";
let nextPeriodDate = "";

let externalCustomerA = "";
let externalCustomerB = "";
let externalSubscriptionA = "";
let externalSubscriptionB = "";
let paymentA = "";
let paymentB = "";
let checkoutRequestA = "";

function errorMessage(error: { message: string } | null): string {
  return error?.message ?? "";
}

function nextMonth(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month, Number(day)));
  return result.toISOString().slice(0, 10);
}

async function createUser(prefix: string) {
  const email = `billing-${prefix}-${runId}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: `Billing ${prefix}` },
  });

  if (error || !data.user) {
    throw new Error(`createUser(${prefix}): ${errorMessage(error)}`);
  }

  userIds.push(data.user.id);
  return { id: data.user.id, email };
}

async function signIn(email: string) {
  const client = createClient(url!, anonKey!, clientOptions);
  const { error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    throw new Error(`signIn: ${error.message}`);
  }

  return client;
}

async function createStore(name: string, slug: string, ownerUserId: string) {
  const { data, error } = await platformClient.rpc("admin_create_store", {
    p_name: name,
    p_slug: slug,
    p_description: null,
    p_phone: null,
    p_plan_id: (await admin.from("plans").select("id").eq("code", "avdelivery").single()).data!.id,
    p_owner_user_id: ownerUserId,
    p_start_trial: true,
    p_request_id: randomUUID(),
  });

  if (error || !data) {
    throw new Error(`createStore: ${errorMessage(error)}`);
  }

  const storeId = String((data as Record<string, unknown>).storeId);
  storeIds.push(storeId);
  return storeId;
}

function paymentArgs(input: {
  externalSubscriptionId: string;
  externalCustomerId: string;
  paymentId: string;
  status: string;
  amountCents?: number;
  eventId: string | null;
}) {
  return {
    p_provider: "asaas",
    p_event_id: input.eventId,
    p_event_type: input.eventId ? "PAYMENT_UPDATED" : "RECONCILIATION",
    p_payment_id: input.paymentId,
    p_external_subscription_id: input.externalSubscriptionId,
    p_external_customer_id: input.externalCustomerId,
    p_external_status: input.status,
    p_amount_cents: input.amountCents ?? priceCents,
    p_currency: "BRL",
    p_due_date: dueDate,
    p_paid_at: new Date().toISOString(),
    p_payment_url: `https://sandbox.asaas.com/i/${input.paymentId}`,
    p_billing_type: "PIX",
    p_payload: { source: "integration-test", paymentId: input.paymentId },
  };
}

describe.skipIf(!enabled)("cobrança Asaas e RLS (integração real)", () => {
  beforeAll(async () => {
    admin = createClient(url!, serviceRoleKey!, clientOptions);
    anon = createClient(url!, anonKey!, clientOptions);

    const adminUser = await createUser("admin");
    const ownerA = await createUser("owner-a");
    const ownerB = await createUser("owner-b");
    platformAdminId = adminUser.id;

    const { error: adminError } = await admin
      .from("platform_admins")
      .insert({ user_id: platformAdminId });

    if (adminError) {
      throw new Error(`platform admin: ${adminError.message}`);
    }

    ownerAClient = await signIn(ownerA.email);
    ownerBClient = await signIn(ownerB.email);
    platformClient = await signIn(adminUser.email);

    storeA = await createStore("Billing Loja A", `billing-a-${runId}`, ownerA.id);
    storeB = await createStore("Billing Loja B", `billing-b-${runId}`, ownerB.id);

    const { data: plan, error: planError } = await admin
      .from("plans")
      .select("price_cents")
      .eq("code", "avdelivery")
      .single();

    if (planError || !plan) {
      throw new Error(`plano: ${planError?.message ?? "ausente"}`);
    }

    priceCents = plan.price_cents;
    dueDate = new Date().toISOString().slice(0, 10);
    nextPeriodDate = nextMonth(dueDate);

    externalCustomerA = `cus_test_a_${runId}`;
    externalCustomerB = `cus_test_b_${runId}`;
    externalSubscriptionA = `sub_test_a_${runId}`;
    externalSubscriptionB = `sub_test_b_${runId}`;
    paymentA = `pay_test_a_${runId}`;
    paymentB = `pay_test_b_${runId}`;

    const profileA = await ownerAClient.rpc("owner_upsert_billing_profile", {
      p_store_id: storeA,
      p_legal_name: "Billing Loja A Ltda",
      p_document: "11222333000181",
      p_email: `financeiro-a-${runId}@example.com`,
      p_phone: "11912345678",
      p_postal_code: "01001000",
      p_address: "Praça da Sé",
      p_address_number: "1",
      p_complement: null,
      p_province: "Centro",
    });

    if (profileA.error) {
      throw new Error(`perfil A: ${profileA.error.message}`);
    }

    const profileB = await ownerBClient.rpc("owner_upsert_billing_profile", {
      p_store_id: storeB,
      p_legal_name: "Billing Loja B Ltda",
      p_document: "52998224725",
      p_email: `financeiro-b-${runId}@example.com`,
      p_phone: "11987654321",
      p_postal_code: null,
      p_address: null,
      p_address_number: null,
      p_complement: null,
      p_province: null,
    });

    if (profileB.error) {
      throw new Error(`perfil B: ${profileB.error.message}`);
    }

    for (const [storeId, customerId] of [
      [storeA, externalCustomerA],
      [storeB, externalCustomerB],
    ]) {
      const bound = await admin.rpc("billing_bind_customer", {
        p_store_id: storeId,
        p_provider: "asaas",
        p_external_customer_id: customerId,
      });

      if (bound.error) {
        throw new Error(`vincular cliente ${customerId}: ${bound.error.message}`);
      }
    }

    for (const [storeId, externalId, paymentId] of [
      [storeA, externalSubscriptionA, paymentA],
      [storeB, externalSubscriptionB, paymentB],
    ]) {
      const requestId = randomUUID();

      if (storeId === storeA) {
        checkoutRequestA = requestId;
      }

      const begin = await admin.rpc("billing_begin_checkout", {
        p_store_id: storeId,
        p_request_id: requestId,
      });

      if (begin.error) {
        throw new Error(`iniciar checkout: ${begin.error.message}`);
      }

      const complete = await admin.rpc("billing_complete_checkout", {
        p_store_id: storeId,
        p_request_id: requestId,
        p_external_subscription_id: externalId,
        p_external_status: "ACTIVE",
        p_payment_id: paymentId,
        p_payment_url: `https://sandbox.asaas.com/i/${paymentId}`,
        p_pix_payload: `pix-${paymentId}`,
        p_amount_cents: priceCents,
        p_due_date: dueDate,
        p_billing_type: "PIX",
      });

      if (complete.error) {
        throw new Error(`concluir checkout: ${complete.error.message}`);
      }
    }

    // Expire the trial/administrative period so payment confirmation is the
    // only thing that can release the stores.
    const expiredStart = new Date(Date.now() - 12 * 86_400_000).toISOString();
    const expiredEnd = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const { error: expiryError } = await admin
      .from("subscriptions")
      .update({
        trial_started_at: expiredStart,
        trial_ends_at: expiredEnd,
        current_period_start: expiredStart,
        current_period_end: expiredEnd,
      })
      .in("store_id", [storeA, storeB]);

    if (expiryError) {
      throw new Error(`expiar teste: ${expiryError.message}`);
    }
  }, 180_000);

  afterAll(async () => {
    if (!enabled || !admin) {
      return;
    }

    try {
      await admin.from("billing_webhook_events").delete().like("external_event_id", `%${runId}%`);
      await admin.from("stores").delete().in("id", storeIds);

      if (platformAdminId) {
        await admin.from("platform_admins").delete().eq("user_id", platformAdminId);
      }

      for (const userId of userIds) {
        await admin.auth.admin.deleteUser(userId);
      }
    } catch (error) {
      console.error(
        "[billing.cleanup]",
        error instanceof Error ? error.message : "erro desconhecido",
      );
    }
  }, 120_000);

  it("mantém perfis isolados por loja e bloqueia escrita direta", async () => {
    const ownA = await ownerAClient.from("billing_customers").select("store_id");
    expect(ownA.error).toBeNull();
    expect(ownA.data?.map((row) => row.store_id)).toEqual([storeA]);

    const ownB = await ownerBClient.from("billing_customers").select("store_id");
    expect(ownB.error).toBeNull();
    expect(ownB.data?.map((row) => row.store_id)).toEqual([storeB]);

    const cross = await ownerBClient.rpc("owner_upsert_billing_profile", {
      p_store_id: storeA,
      p_legal_name: "Invasão",
      p_document: "11222333000181",
      p_email: "invasao@example.com",
      p_phone: "11999999999",
      p_postal_code: null,
      p_address: null,
      p_address_number: null,
      p_complement: null,
      p_province: null,
    });
    expect(cross.error).not.toBeNull();
    expect(errorMessage(cross.error)).toContain("forbidden");

    const directInsert = await ownerAClient.from("billing_customers").insert({
      store_id: storeA,
      legal_name: "Direto",
      document: "11222333000181",
      email: "direto@example.com",
      phone: "11999999999",
    });
    expect(directInsert.error).not.toBeNull();

    const inbox = await ownerAClient.from("billing_webhook_events").select("id");
    expect(inbox.error !== null || (inbox.data?.length ?? 0) === 0).toBe(true);

    const serviceRpc = await ownerAClient.rpc(
      "billing_apply_payment_event",
      paymentArgs({
        externalSubscriptionId: externalSubscriptionA,
        externalCustomerId: externalCustomerA,
        paymentId: paymentA,
        status: "CONFIRMED",
        eventId: null,
      }),
    );
    expect(serviceRpc.error).not.toBeNull();

    const checkoutA = await ownerAClient.from("billing_checkout_requests").select("store_id");
    expect(checkoutA.data?.map((row) => row.store_id)).toEqual([storeA]);
  });

  it("cria assinatura externa sem liberar a loja", async () => {
    const { data: subscription, error } = await admin
      .from("subscriptions")
      .select("status, external_subscription_id, current_period_end")
      .eq("store_id", storeA)
      .single();

    expect(error).toBeNull();
    expect(subscription).toMatchObject({
      status: "trialing",
      external_subscription_id: externalSubscriptionA,
    });
    expect(subscription?.current_period_end).toBeTruthy();

    const { data: invoice } = await admin
      .from("invoices")
      .select("status, paid_at, amount_cents, external_payment_id")
      .eq("store_id", storeA)
      .single();

    expect(invoice).toMatchObject({
      status: "pending",
      paid_at: null,
      amount_cents: priceCents,
      external_payment_id: paymentA,
    });

    const status = await anon.rpc("get_store_commercial_status", {
      p_store_slug: `billing-a-${runId}`,
    });
    expect(status.data).toMatchObject({ hasAccess: false, state: "expired" });
  });

  it("rejeita valor adulterado, cliente divergente e assinatura desconhecida", async () => {
    const tampered = await admin.rpc(
      "billing_apply_payment_event",
      paymentArgs({
        externalSubscriptionId: externalSubscriptionA,
        externalCustomerId: externalCustomerA,
        paymentId: `pay_tampered_${runId}`,
        status: "CONFIRMED",
        amountCents: 100,
        eventId: null,
      }),
    );
    expect(tampered.error).not.toBeNull();
    expect(errorMessage(tampered.error)).toContain("amount_mismatch");

    const { count: tamperedInvoices } = await admin
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("external_payment_id", `pay_tampered_${runId}`);
    expect(tamperedInvoices).toBe(0);

    const wrongCustomer = await admin.rpc(
      "billing_apply_payment_event",
      paymentArgs({
        externalSubscriptionId: externalSubscriptionA,
        externalCustomerId: externalCustomerB,
        paymentId: paymentA,
        status: "CONFIRMED",
        eventId: null,
      }),
    );
    expect(wrongCustomer.error).not.toBeNull();
    expect(errorMessage(wrongCustomer.error)).toContain("external_customer_mismatch");

    const unknown = await admin.rpc(
      "billing_apply_payment_event",
      paymentArgs({
        externalSubscriptionId: `sub_unknown_${runId}`,
        externalCustomerId: externalCustomerA,
        paymentId: paymentA,
        status: "CONFIRMED",
        eventId: null,
      }),
    );
    expect(unknown.error).not.toBeNull();
    expect(errorMessage(unknown.error)).toContain("external_subscription_unknown");

    const tamperedCheckout = await admin.rpc("billing_complete_checkout", {
      p_store_id: storeA,
      p_request_id: checkoutRequestA,
      p_external_subscription_id: externalSubscriptionA,
      p_external_status: "ACTIVE",
      p_payment_id: `pay_checkout_tampered_${runId}`,
      p_payment_url: "https://sandbox.asaas.com/i/checkout-tampered",
      p_pix_payload: null,
      p_amount_cents: 100,
      p_due_date: dueDate,
      p_billing_type: "PIX",
    });
    expect(tamperedCheckout.error).not.toBeNull();
    expect(errorMessage(tamperedCheckout.error)).toContain("amount_mismatch");

    const { count: checkoutTamperedInvoices } = await admin
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("external_payment_id", `pay_checkout_tampered_${runId}`);
    expect(checkoutTamperedInvoices).toBe(0);

    const { data: invoice } = await admin
      .from("invoices")
      .select("status, paid_at")
      .eq("store_id", storeA)
      .single();
    expect(invoice).toMatchObject({ status: "pending", paid_at: null });
  });

  it("confirma o pagamento, libera a loja e não estende o período duas vezes", async () => {
    const eventId = `evt-${runId}-paid`;
    const paid = await admin.rpc(
      "billing_apply_payment_event",
      paymentArgs({
        externalSubscriptionId: externalSubscriptionA,
        externalCustomerId: externalCustomerA,
        paymentId: paymentA,
        status: "CONFIRMED",
        eventId,
      }),
    );

    expect(paid.error).toBeNull();
    expect(paid.data).toMatchObject({ storeId: storeA, status: "paid", state: "active" });

    const { data: subscription } = await admin
      .from("subscriptions")
      .select("status, current_period_end, grace_ends_at, canceled_at")
      .eq("store_id", storeA)
      .single();

    expect(subscription?.status).toBe("active");
    expect(subscription?.canceled_at).toBeNull();
    expect(new Date(subscription!.current_period_end!).toISOString().slice(0, 10)).toBe(
      nextPeriodDate,
    );
    expect(subscription?.grace_ends_at).toBeTruthy();
    const firstPeriodEnd = subscription!.current_period_end;

    const { data: invoice } = await admin
      .from("invoices")
      .select("status, paid_at")
      .eq("store_id", storeA)
      .single();
    expect(invoice?.status).toBe("paid");
    expect(invoice?.paid_at).toBeTruthy();

    const status = await anon.rpc("get_store_commercial_status", {
      p_store_slug: `billing-a-${runId}`,
    });
    expect(status.data).toMatchObject({ hasAccess: true, state: "active" });

    // Same event and same payment again: no double extension, no duplicate event.
    const duplicate = await admin.rpc(
      "billing_apply_payment_event",
      paymentArgs({
        externalSubscriptionId: externalSubscriptionA,
        externalCustomerId: externalCustomerA,
        paymentId: paymentA,
        status: "CONFIRMED",
        eventId,
      }),
    );
    expect(duplicate.error).toBeNull();

    // Out-of-order PENDING must not downgrade a paid invoice.
    const latePending = await admin.rpc(
      "billing_apply_payment_event",
      paymentArgs({
        externalSubscriptionId: externalSubscriptionA,
        externalCustomerId: externalCustomerA,
        paymentId: paymentA,
        status: "PENDING",
        eventId: `evt-${runId}-late-pending`,
      }),
    );
    expect(latePending.error).toBeNull();

    const { data: after } = await admin
      .from("subscriptions")
      .select("status, current_period_end")
      .eq("store_id", storeA)
      .single();
    expect(after).toMatchObject({ status: "active", current_period_end: firstPeriodEnd });

    const { data: afterInvoice } = await admin
      .from("invoices")
      .select("status, paid_at")
      .eq("store_id", storeA)
      .single();
    expect(afterInvoice?.status).toBe("paid");
    expect(afterInvoice?.paid_at).toBe(invoice?.paid_at);

    const { count: confirmedEvents } = await admin
      .from("subscription_events")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeA)
      .eq("event_type", "payment_confirmed");
    expect(confirmedEvents).toBe(1);

    const { data: inbox } = await admin
      .from("billing_webhook_events")
      .select("status, attempts")
      .eq("external_event_id", eventId)
      .single();
    expect(inbox?.status).toBe("processed");
    expect(inbox!.attempts).toBeGreaterThanOrEqual(2);

    const duplicateInbox = await admin.from("billing_webhook_events").insert({
      provider: "asaas",
      external_event_id: eventId,
      event_type: "PAYMENT_UPDATED",
      payload: { id: eventId },
    });
    expect(duplicateInbox.error?.code).toBe("23505");
  });

  it("processa confirmações concorrentes sem duplicar período ou evento", async () => {
    const before = await admin
      .from("subscriptions")
      .select("current_period_end")
      .eq("store_id", storeA)
      .single();

    const results = await Promise.all([
      admin.rpc(
        "billing_apply_payment_event",
        paymentArgs({
          externalSubscriptionId: externalSubscriptionA,
          externalCustomerId: externalCustomerA,
          paymentId: paymentA,
          status: "CONFIRMED",
          eventId: `evt-${runId}-concurrent-1`,
        }),
      ),
      admin.rpc(
        "billing_apply_payment_event",
        paymentArgs({
          externalSubscriptionId: externalSubscriptionA,
          externalCustomerId: externalCustomerA,
          paymentId: paymentA,
          status: "CONFIRMED",
          eventId: `evt-${runId}-concurrent-2`,
        }),
      ),
    ]);

    expect(results.every((result) => result.error === null)).toBe(true);

    const after = await admin
      .from("subscriptions")
      .select("current_period_end")
      .eq("store_id", storeA)
      .single();
    expect(after.data?.current_period_end).toBe(before.data?.current_period_end);

    const { count } = await admin
      .from("subscription_events")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeA)
      .eq("event_type", "payment_confirmed");
    expect(count).toBe(1);
  });

  it("estorna o pagamento, cancela o acesso e não reativa com evento atrasado", async () => {
    const refund = await admin.rpc(
      "billing_apply_payment_event",
      paymentArgs({
        externalSubscriptionId: externalSubscriptionA,
        externalCustomerId: externalCustomerA,
        paymentId: paymentA,
        status: "REFUNDED",
        eventId: `evt-${runId}-refunded`,
      }),
    );
    expect(refund.error).toBeNull();
    expect(refund.data).toMatchObject({ status: "refunded", state: "canceled" });

    const { data: subscription } = await admin
      .from("subscriptions")
      .select("status, canceled_at")
      .eq("store_id", storeA)
      .single();
    expect(subscription?.status).toBe("canceled");
    expect(subscription?.canceled_at).toBeTruthy();

    const status = await anon.rpc("get_store_commercial_status", {
      p_store_slug: `billing-a-${runId}`,
    });
    expect(status.data).toMatchObject({ hasAccess: false, state: "canceled" });

    const latePaid = await admin.rpc(
      "billing_apply_payment_event",
      paymentArgs({
        externalSubscriptionId: externalSubscriptionA,
        externalCustomerId: externalCustomerA,
        paymentId: paymentA,
        status: "CONFIRMED",
        eventId: `evt-${runId}-late-paid-after-refund`,
      }),
    );
    expect(latePaid.error).toBeNull();

    const { data: after } = await admin
      .from("subscriptions")
      .select("status")
      .eq("store_id", storeA)
      .single();
    expect(after?.status).toBe("canceled");

    const { data: invoice } = await admin
      .from("invoices")
      .select("status, paid_at")
      .eq("store_id", storeA)
      .single();
    expect(invoice?.status).toBe("refunded");
    expect(invoice?.paid_at).toBeTruthy();

    const { count: refundEvents } = await admin
      .from("subscription_events")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeA)
      .eq("event_type", "payment_refunded");
    expect(refundEvents).toBe(1);
  });

  it("reativa outra loja após atraso e trata chargeback", async () => {
    const overdue = await admin.rpc(
      "billing_apply_payment_event",
      paymentArgs({
        externalSubscriptionId: externalSubscriptionB,
        externalCustomerId: externalCustomerB,
        paymentId: paymentB,
        status: "OVERDUE",
        eventId: `evt-${runId}-b-overdue`,
      }),
    );
    expect(overdue.error).toBeNull();
    expect(overdue.data).toMatchObject({ status: "overdue", state: "expired" });

    const paid = await admin.rpc(
      "billing_apply_payment_event",
      paymentArgs({
        externalSubscriptionId: externalSubscriptionB,
        externalCustomerId: externalCustomerB,
        paymentId: paymentB,
        status: "CONFIRMED",
        eventId: `evt-${runId}-b-paid`,
      }),
    );
    expect(paid.error).toBeNull();
    expect(paid.data).toMatchObject({ status: "paid", state: "active" });

    const chargeback = await admin.rpc(
      "billing_apply_payment_event",
      paymentArgs({
        externalSubscriptionId: externalSubscriptionB,
        externalCustomerId: externalCustomerB,
        paymentId: paymentB,
        status: "CHARGEBACK_REQUESTED",
        eventId: `evt-${runId}-b-chargeback`,
      }),
    );
    expect(chargeback.error).toBeNull();
    expect(chargeback.data).toMatchObject({ status: "chargeback", state: "canceled" });

    const { data: invoice } = await admin
      .from("invoices")
      .select("status")
      .eq("store_id", storeB)
      .single();
    expect(invoice?.status).toBe("chargeback");

    const status = await anon.rpc("get_store_commercial_status", {
      p_store_slug: `billing-b-${runId}`,
    });
    expect(status.data).toMatchObject({ hasAccess: false, state: "canceled" });
  });
});
