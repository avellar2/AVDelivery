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
let clientOwnerA: SupabaseClient;
let clientEmployeeA: SupabaseClient;
let clientDriverA: SupabaseClient;
let clientDriverA2: SupabaseClient;
let clientOwnerB: SupabaseClient;
let clientDriverB: SupabaseClient;

const users: string[] = [];
const stores: string[] = [];

let storeA = "";
let storeB = "";
let slugA = "";
let slugB = "";
let productA = "";
let productB = "";
let driverAProfile = "";
let driverA2Profile = "";
let driverBProfile = "";

let phoneSeq = 0;

function nextPhone(): string {
  phoneSeq += 1;
  return `119${String(10_000_000 + phoneSeq).padStart(8, "0")}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function newKey(): string {
  return randomUUID().replace(/-/g, "");
}

function newTokenHash(): string {
  return sha256(randomUUID());
}

function errorMessage(error: { message: string } | null): string {
  return error?.message ?? "";
}

function orderPayload(productId: string, overrides: Record<string, unknown> = {}) {
  return {
    customerName: "Cliente Entregas",
    customerPhone: nextPhone(),
    fulfillmentType: "delivery",
    address: {
      street: "Rua das Entregas",
      number: "45",
      complement: "",
      district: "Centro",
      city: "São Paulo",
      reference: "",
      postalCode: "01000-000",
    },
    paymentMethod: "cash",
    notes: "",
    items: [{ productId, quantity: 1, notes: "", options: [] }],
    ...overrides,
  };
}

type CreatedOrder = {
  orderId: string;
  orderNumber: number;
  tokenHash: string;
};

async function createOrderAt(slug: string, productId: string): Promise<CreatedOrder> {
  const payload = orderPayload(productId);
  const tokenHash = newTokenHash();
  const response = await anon.rpc("create_order", {
    p_store_slug: slug,
    p_payload: payload,
    p_idempotency_key: newKey(),
    p_request_hash: sha256(JSON.stringify(payload)),
    p_tracking_token_hash: tokenHash,
  });

  if (response.error) {
    throw new Error(`create_order: ${response.error.message}`);
  }

  const data = response.data as Record<string, unknown>;

  return {
    orderId: String(data.orderId),
    orderNumber: Number(data.orderNumber),
    tokenHash,
  };
}

async function advanceOrder(
  client: SupabaseClient,
  orderId: string,
  statuses: string[],
): Promise<void> {
  for (const status of statuses) {
    const response = await client.rpc("update_order_status", {
      p_order_id: orderId,
      p_new_status: status,
    });

    if (response.error) {
      throw new Error(`update_order_status(${status}): ${response.error.message}`);
    }
  }
}

async function readyOrderAtStoreA(): Promise<CreatedOrder> {
  const order = await createOrderAt(slugA, productA);
  await advanceOrder(clientOwnerA, order.orderId, ["accepted", "preparing", "ready"]);
  return order;
}

async function activeDeliveriesFor(orderId: string) {
  const { data } = await admin
    .from("deliveries")
    .select("id, status, driver_profile_id")
    .eq("order_id", orderId)
    .in("status", ["assigned", "picked_up"]);

  return data ?? [];
}

describe.skipIf(!enabled)("entregadores e entregas (integração real)", () => {
  beforeAll(async () => {
    admin = createClient(url!, serviceRoleKey!, clientOptions);
    anon = createClient(url!, anonKey!, clientOptions);

    async function createUser(prefix: string, name: string) {
      const email = `deliveries-${prefix}-${runId}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      });

      if (error || !data.user) {
        throw new Error(`createUser(${prefix}): ${error?.message ?? "erro desconhecido"}`);
      }

      users.push(data.user.id);
      return { id: data.user.id, email };
    }

    const ownerA = await createUser("owner-a", "Entregas Dono A");
    const managerA = await createUser("manager-a", "Entregas Gerente A");
    const employeeA = await createUser("employee-a", "Entregas Funcionário A");
    const driverA = await createUser("driver-a", "Entregas Motorista A");
    const driverA2 = await createUser("driver-a2", "Entregas Motorista A2");
    const ownerB = await createUser("owner-b", "Entregas Dono B");
    const driverB = await createUser("driver-b", "Entregas Motorista B");

    slugA = `entregas-a-${runId}`;
    slugB = `entregas-b-${runId}`;

    const { data: createdStores, error: storesError } = await admin
      .from("stores")
      .insert([
        {
          name: "Entregas Loja A",
          slug: slugA,
          active: true,
          accepting_orders: true,
          delivery_enabled: true,
          pickup_enabled: true,
          delivery_fee_cents: 0,
          min_order_cents: 0,
          payment_pix_enabled: false,
          payment_cash_enabled: true,
          payment_card_on_delivery_enabled: false,
        },
        {
          name: "Entregas Loja B",
          slug: slugB,
          active: true,
          accepting_orders: true,
          delivery_enabled: true,
          pickup_enabled: true,
          delivery_fee_cents: 0,
          min_order_cents: 0,
          payment_pix_enabled: false,
          payment_cash_enabled: true,
          payment_card_on_delivery_enabled: false,
        },
      ])
      .select("id, slug");

    if (storesError || !createdStores) {
      throw new Error(`insert stores: ${storesError?.message ?? "sem dados"}`);
    }

    storeA = createdStores.find((row) => row.slug === slugA)!.id;
    storeB = createdStores.find((row) => row.slug === slugB)!.id;
    stores.push(storeA, storeB);

    const { error: membershipError } = await admin.from("store_memberships").insert([
      { store_id: storeA, user_id: ownerA.id, role: "owner" },
      { store_id: storeA, user_id: managerA.id, role: "manager" },
      { store_id: storeA, user_id: employeeA.id, role: "employee" },
      { store_id: storeB, user_id: ownerB.id, role: "owner" },
    ]);

    if (membershipError) {
      throw new Error(`insert memberships: ${membershipError.message}`);
    }

    async function signIn(email: string) {
      const client = createClient(url!, anonKey!, clientOptions);
      const { error } = await client.auth.signInWithPassword({ email, password });

      if (error) {
        throw new Error(`signIn(${email}): ${error.message}`);
      }

      return client;
    }

    clientOwnerA = await signIn(ownerA.email);
    clientEmployeeA = await signIn(employeeA.email);
    clientDriverA = await signIn(driverA.email);
    clientDriverA2 = await signIn(driverA2.email);
    clientOwnerB = await signIn(ownerB.email);
    clientDriverB = await signIn(driverB.email);

    const { data: categories, error: categoriesError } = await admin
      .from("categories")
      .insert([
        { store_id: storeA, name: "Entregas", active: true },
        { store_id: storeB, name: "Entregas", active: true },
      ])
      .select("id, store_id");

    if (categoriesError || !categories) {
      throw new Error(`insert categories: ${categoriesError?.message ?? "sem dados"}`);
    }

    const { data: products, error: productsError } = await admin
      .from("products")
      .insert([
        {
          store_id: storeA,
          category_id: categories.find((row) => row.store_id === storeA)!.id,
          name: "Prato A",
          price_cents: 2000,
          available: true,
        },
        {
          store_id: storeB,
          category_id: categories.find((row) => row.store_id === storeB)!.id,
          name: "Prato B",
          price_cents: 3000,
          available: true,
        },
      ])
      .select("id, store_id");

    if (productsError || !products) {
      throw new Error(`insert products: ${productsError?.message ?? "sem dados"}`);
    }

    productA = products.find((row) => row.store_id === storeA)!.id;
    productB = products.find((row) => row.store_id === storeB)!.id;

    const createdDriverA2 = await clientOwnerA.rpc("create_driver", {
      p_store_id: storeA,
      p_user_id: driverA2.id,
      p_display_name: "Motorista A2",
      p_phone: "11977776666",
    });

    if (createdDriverA2.error) {
      throw new Error(`create_driver(a2): ${createdDriverA2.error.message}`);
    }

    driverA2Profile = String((createdDriverA2.data as Record<string, unknown>).driverProfileId);

    const createdDriverA = await clientOwnerA.rpc("create_driver", {
      p_store_id: storeA,
      p_user_id: driverA.id,
      p_display_name: "Motorista A",
      p_phone: "11966665555",
    });

    if (createdDriverA.error) {
      throw new Error(`create_driver(a): ${createdDriverA.error.message}`);
    }

    driverAProfile = String((createdDriverA.data as Record<string, unknown>).driverProfileId);

    const createdDriverB = await clientOwnerB.rpc("create_driver", {
      p_store_id: storeB,
      p_user_id: driverB.id,
      p_display_name: "Motorista B",
      p_phone: "11955554444",
    });

    if (createdDriverB.error) {
      throw new Error(`create_driver(b): ${createdDriverB.error.message}`);
    }

    driverBProfile = String((createdDriverB.data as Record<string, unknown>).driverProfileId);
  }, 120_000);

  afterAll(async () => {
    if (!enabled || !admin) {
      return;
    }

    try {
      if (stores.length > 0) {
        await admin.from("deliveries").delete().in("store_id", stores);
        await admin.from("driver_profiles").delete().in("store_id", stores);
        await admin.from("orders").delete().in("store_id", stores);
        await admin.from("customers").delete().in("store_id", stores);
        await admin.from("products").delete().in("store_id", stores);
        await admin.from("categories").delete().in("store_id", stores);
        await admin.from("store_memberships").delete().in("store_id", stores);
        await admin.from("stores").delete().in("id", stores);
      }

      for (const userId of users) {
        await admin.auth.admin.deleteUser(userId);
      }
    } catch (error) {
      console.error(
        "[deliveries.cleanup]",
        error instanceof Error ? error.message : "erro desconhecido",
      );
    }
  }, 120_000);

  it("cadastra entregador, cria o vínculo e bloqueia conflitos", async () => {
    const { data: membership } = await admin
      .from("store_memberships")
      .select("role")
      .eq("store_id", storeA)
      .eq("user_id", users[3])
      .maybeSingle();

    expect(membership?.role).toBe("driver");

    const duplicate = await clientOwnerA.rpc("create_driver", {
      p_store_id: storeA,
      p_user_id: users[3],
      p_display_name: "Outro nome",
      p_phone: null,
    });
    expect(errorMessage(duplicate.error)).toContain("driver_exists");

    const conflict = await clientOwnerA.rpc("create_driver", {
      p_store_id: storeA,
      p_user_id: users[2],
      p_display_name: "Funcionário",
      p_phone: null,
    });
    expect(errorMessage(conflict.error)).toContain("user_role_conflict");

    const employeeAttempt = await clientEmployeeA.rpc("create_driver", {
      p_store_id: storeA,
      p_user_id: users[5],
      p_display_name: "Invasor",
      p_phone: null,
    });
    expect(errorMessage(employeeAttempt.error)).toContain("forbidden");

    const otherStore = await clientOwnerB.rpc("create_driver", {
      p_store_id: storeA,
      p_user_id: users[5],
      p_display_name: "Invasor",
      p_phone: null,
    });
    expect(errorMessage(otherStore.error)).toContain("forbidden");
  });

  it("isola perfis: cada entregador vê apenas o próprio cadastro", async () => {
    const own = await clientDriverA.from("driver_profiles").select("id, display_name, phone");
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);
    expect(own.data?.[0]?.id).toBe(driverAProfile);

    const everyone = await clientOwnerA.from("driver_profiles").select("id").eq("store_id", storeA);
    expect(everyone.data?.length).toBeGreaterThanOrEqual(2);

    const crossStore = await clientOwnerB
      .from("driver_profiles")
      .select("id")
      .eq("store_id", storeA);
    expect(crossStore.data).toEqual([]);

    const anonRead = await anon.from("driver_profiles").select("id").eq("store_id", storeA);
    expect(anonRead.error).not.toBeNull();
  });

  it("atribui o pedido, entrega ao entregador e registra o evento", async () => {
    const order = await readyOrderAtStoreA();

    const employeeAttempt = await clientEmployeeA.rpc("assign_delivery", {
      p_order_id: order.orderId,
      p_driver_profile_id: driverAProfile,
    });
    expect(errorMessage(employeeAttempt.error)).toContain("forbidden");

    const driverAttempt = await clientDriverA.rpc("assign_delivery", {
      p_order_id: order.orderId,
      p_driver_profile_id: driverAProfile,
    });
    expect(errorMessage(driverAttempt.error)).toContain("forbidden");

    const assigned = await clientOwnerA.rpc("assign_delivery", {
      p_order_id: order.orderId,
      p_driver_profile_id: driverAProfile,
    });

    expect(assigned.error).toBeNull();
    expect(assigned.data).toMatchObject({ status: "assigned", driverProfileId: driverAProfile });

    const deliveryId = String((assigned.data as Record<string, unknown>).deliveryId);

    const repeated = await clientOwnerA.rpc("assign_delivery", {
      p_order_id: order.orderId,
      p_driver_profile_id: driverAProfile,
    });
    expect(repeated.error).toBeNull();
    expect((repeated.data as Record<string, unknown>).deliveryId).toBe(deliveryId);
    expect(await activeDeliveriesFor(order.orderId)).toHaveLength(1);

    const { data: event } = await admin
      .from("delivery_events")
      .select("previous_status, new_status")
      .eq("delivery_id", deliveryId)
      .single();
    expect(event).toEqual({ previous_status: null, new_status: "assigned" });

    const driverOrders = await clientDriverA
      .from("orders")
      .select("id, customer_name, delivery_address_snapshot")
      .eq("id", order.orderId);
    expect(driverOrders.error).toBeNull();
    expect(driverOrders.data).toHaveLength(1);

    const driverCustomers = await clientDriverA
      .from("customers")
      .select("id")
      .eq("store_id", storeA);
    expect(driverCustomers.data).toEqual([]);

    const anonDeliveries = await anon.from("deliveries").select("id").eq("store_id", storeA);
    expect(anonDeliveries.error).not.toBeNull();
  });

  it("exige pedido pronto para iniciar e inicia uma única vez", async () => {
    const order = await createOrderAt(slugA, productA);

    const assigned = await clientOwnerA.rpc("assign_delivery", {
      p_order_id: order.orderId,
      p_driver_profile_id: driverAProfile,
    });
    expect(assigned.error).toBeNull();
    const deliveryId = String((assigned.data as Record<string, unknown>).deliveryId);

    const tooEarly = await clientDriverA.rpc("start_delivery", { p_delivery_id: deliveryId });
    expect(errorMessage(tooEarly.error)).toContain("order_not_ready");

    await advanceOrder(clientOwnerA, order.orderId, ["accepted", "preparing", "ready"]);

    const wrongDriver = await clientDriverA2.rpc("start_delivery", { p_delivery_id: deliveryId });
    expect(errorMessage(wrongDriver.error)).toContain("forbidden");

    const started = await clientDriverA.rpc("start_delivery", { p_delivery_id: deliveryId });
    expect(started.error).toBeNull();
    expect(started.data).toMatchObject({
      deliveryStatus: "picked_up",
      orderStatus: "out_for_delivery",
      changed: true,
    });

    const again = await clientDriverA.rpc("start_delivery", { p_delivery_id: deliveryId });
    expect(again.error).toBeNull();
    expect((again.data as Record<string, unknown>).changed).toBe(false);

    const { data: storedOrder } = await admin
      .from("orders")
      .select("status")
      .eq("id", order.orderId)
      .single();
    expect(storedOrder?.status).toBe("out_for_delivery");

    const { data: orderEvents } = await admin
      .from("order_events")
      .select("new_status")
      .eq("order_id", order.orderId)
      .eq("new_status", "out_for_delivery");
    expect(orderEvents).toHaveLength(1);

    const completed = await clientDriverA.rpc("complete_delivery", { p_delivery_id: deliveryId });
    expect(completed.error).toBeNull();
    expect(completed.data).toMatchObject({
      deliveryStatus: "delivered",
      orderStatus: "delivered",
      changed: true,
    });

    const { data: deliveredOrder } = await admin
      .from("orders")
      .select("status")
      .eq("id", order.orderId)
      .single();
    expect(deliveredOrder?.status).toBe("delivered");

    const duplicate = await clientDriverA.rpc("complete_delivery", { p_delivery_id: deliveryId });
    expect(duplicate.error).toBeNull();
    expect((duplicate.data as Record<string, unknown>).changed).toBe(false);

    const tracking = await anon.rpc("get_order_tracking", {
      p_store_slug: slugA,
      p_order_number: order.orderNumber,
      p_tracking_token_hash: order.tokenHash,
    });

    expect(tracking.error).toBeNull();
    const tracked = tracking.data as Record<string, unknown>;
    expect(tracked.delivery).toMatchObject({ status: "delivered" });
    expect(JSON.stringify(tracked)).not.toContain("Motorista A");
    expect(tracked).not.toHaveProperty("driverProfileId");
  });

  it("não conclui sem coletar", async () => {
    const order = await readyOrderAtStoreA();
    const assigned = await clientOwnerA.rpc("assign_delivery", {
      p_order_id: order.orderId,
      p_driver_profile_id: driverAProfile,
    });
    const deliveryId = String((assigned.data as Record<string, unknown>).deliveryId);

    const attempt = await clientDriverA.rpc("complete_delivery", { p_delivery_id: deliveryId });
    expect(errorMessage(attempt.error)).toContain("pickup_required");
  });

  it("reatribui e revoga o acesso operacional do entregador anterior", async () => {
    const order = await readyOrderAtStoreA();
    const assigned = await clientOwnerA.rpc("assign_delivery", {
      p_order_id: order.orderId,
      p_driver_profile_id: driverAProfile,
    });
    const oldDeliveryId = String((assigned.data as Record<string, unknown>).deliveryId);

    const missingReason = await clientOwnerA.rpc("reassign_delivery", {
      p_delivery_id: oldDeliveryId,
      p_new_driver_profile_id: driverA2Profile,
      p_reason: " ",
    });
    expect(errorMessage(missingReason.error)).toContain("reassign_reason_required");

    const reassigned = await clientOwnerA.rpc("reassign_delivery", {
      p_delivery_id: oldDeliveryId,
      p_new_driver_profile_id: driverA2Profile,
      p_reason: "Entregador anterior ficou sem sinal",
    });

    expect(reassigned.error).toBeNull();
    expect(reassigned.data).toMatchObject({
      status: "assigned",
      driverProfileId: driverA2Profile,
      reassigned: true,
    });

    const newDeliveryId = String((reassigned.data as Record<string, unknown>).deliveryId);
    expect(newDeliveryId).not.toBe(oldDeliveryId);

    const { data: oldDelivery } = await admin
      .from("deliveries")
      .select("status, cancel_reason")
      .eq("id", oldDeliveryId)
      .single();
    expect(oldDelivery?.status).toBe("canceled");
    expect(oldDelivery?.cancel_reason).toContain("Entregador anterior ficou sem sinal");

    const oldDriverStart = await clientDriverA.rpc("start_delivery", {
      p_delivery_id: newDeliveryId,
    });
    expect(errorMessage(oldDriverStart.error)).toContain("forbidden");

    const oldDriverOrder = await clientDriverA.from("orders").select("id").eq("id", order.orderId);
    expect(oldDriverOrder.data).toEqual([]);

    const oldDriverHistory = await clientDriverA
      .from("deliveries")
      .select("id, status")
      .eq("id", oldDeliveryId);
    expect(oldDriverHistory.data).toEqual([{ id: oldDeliveryId, status: "canceled" }]);

    const newDriverOrder = await clientDriverA2.from("orders").select("id").eq("id", order.orderId);
    expect(newDriverOrder.data).toHaveLength(1);

    const customer = await clientDriverA2
      .from("orders")
      .select("customer_phone")
      .eq("id", order.orderId)
      .single();
    expect(customer.data?.customer_phone).toBeTruthy();
  });

  it("cancela a atribuição apenas antes da coleta", async () => {
    const order = await readyOrderAtStoreA();
    const assigned = await clientOwnerA.rpc("assign_delivery", {
      p_order_id: order.orderId,
      p_driver_profile_id: driverAProfile,
    });
    const deliveryId = String((assigned.data as Record<string, unknown>).deliveryId);

    const canceled = await clientOwnerA.rpc("cancel_delivery", {
      p_delivery_id: deliveryId,
      p_reason: "Entregador indisponível",
    });
    expect(canceled.error).toBeNull();
    expect(canceled.data).toMatchObject({ status: "canceled", changed: true });

    const again = await clientOwnerA.rpc("cancel_delivery", {
      p_delivery_id: deliveryId,
      p_reason: null,
    });
    expect(again.error).toBeNull();
    expect((again.data as Record<string, unknown>).changed).toBe(false);

    const driverStart = await clientDriverA.rpc("start_delivery", { p_delivery_id: deliveryId });
    expect(errorMessage(driverStart.error)).toContain("delivery_not_active");

    const second = await readyOrderAtStoreA();
    const assigned2 = await clientOwnerA.rpc("assign_delivery", {
      p_order_id: second.orderId,
      p_driver_profile_id: driverAProfile,
    });
    await advanceOrder(clientOwnerA, second.orderId, ["out_for_delivery"]);
    const delivery2 = String((assigned2.data as Record<string, unknown>).deliveryId);
    await clientDriverA.rpc("start_delivery", { p_delivery_id: delivery2 });

    const afterPickup = await clientOwnerA.rpc("cancel_delivery", {
      p_delivery_id: delivery2,
      p_reason: "Tarde demais",
    });
    expect(errorMessage(afterPickup.error)).toContain("delivery_already_picked_up");
  });

  it("serializa atribuições concorrentes em uma única entrega ativa", async () => {
    const order = await readyOrderAtStoreA();

    const [first, second] = await Promise.all([
      clientOwnerA.rpc("assign_delivery", {
        p_order_id: order.orderId,
        p_driver_profile_id: driverAProfile,
      }),
      clientOwnerA.rpc("assign_delivery", {
        p_order_id: order.orderId,
        p_driver_profile_id: driverA2Profile,
      }),
    ]);

    const failures = [first, second].filter((result) => result.error !== null);
    expect(failures).toHaveLength(1);
    expect(errorMessage(failures[0]?.error ?? null)).toContain("active_delivery_exists");

    const active = await activeDeliveriesFor(order.orderId);
    expect(active).toHaveLength(1);
  });

  it("conclui uma única vez sob concorrência", async () => {
    const order = await readyOrderAtStoreA();
    const assigned = await clientOwnerA.rpc("assign_delivery", {
      p_order_id: order.orderId,
      p_driver_profile_id: driverAProfile,
    });
    const deliveryId = String((assigned.data as Record<string, unknown>).deliveryId);
    await clientDriverA.rpc("start_delivery", { p_delivery_id: deliveryId });

    const [first, second] = await Promise.all([
      clientDriverA.rpc("complete_delivery", { p_delivery_id: deliveryId }),
      clientDriverA.rpc("complete_delivery", { p_delivery_id: deliveryId }),
    ]);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    const changed = [first, second]
      .map((result) => (result.data as Record<string, unknown>).changed)
      .sort();
    expect(changed).toEqual([false, true]);

    const { data: orderEvents } = await admin
      .from("order_events")
      .select("id")
      .eq("order_id", order.orderId)
      .eq("new_status", "delivered");
    expect(orderEvents).toHaveLength(1);
  });

  it("impede desativar entregador com entrega ativa e bloqueia entregador inativo", async () => {
    const order = await readyOrderAtStoreA();
    const assigned = await clientOwnerA.rpc("assign_delivery", {
      p_order_id: order.orderId,
      p_driver_profile_id: driverAProfile,
    });
    const deliveryId = String((assigned.data as Record<string, unknown>).deliveryId);

    const blocked = await clientOwnerA.rpc("update_driver", {
      p_driver_profile_id: driverAProfile,
      p_display_name: "Motorista A",
      p_phone: "11966665555",
      p_active: false,
    });
    expect(errorMessage(blocked.error)).toContain("driver_has_active_deliveries");

    await clientOwnerA.rpc("cancel_delivery", { p_delivery_id: deliveryId, p_reason: null });

    // Other tests may leave live deliveries for this driver; close them before
    // checking that deactivation is allowed once the queue is clear.
    const { data: remaining } = await admin
      .from("deliveries")
      .select("id, status")
      .eq("driver_profile_id", driverAProfile)
      .in("status", ["assigned", "picked_up"]);

    for (const row of remaining ?? []) {
      if (row.status === "assigned") {
        await clientOwnerA.rpc("cancel_delivery", {
          p_delivery_id: row.id,
          p_reason: "Limpeza do teste",
        });
      } else {
        await clientDriverA.rpc("complete_delivery", { p_delivery_id: row.id });
      }
    }

    const deactivated = await clientOwnerA.rpc("update_driver", {
      p_driver_profile_id: driverAProfile,
      p_display_name: "Motorista A",
      p_phone: "11966665555",
      p_active: false,
    });
    expect(deactivated.error).toBeNull();

    const otherOrder = await readyOrderAtStoreA();
    const inactiveAssign = await clientOwnerA.rpc("assign_delivery", {
      p_order_id: otherOrder.orderId,
      p_driver_profile_id: driverAProfile,
    });
    expect(errorMessage(inactiveAssign.error)).toContain("driver_inactive");

    const reactivated = await clientOwnerA.rpc("update_driver", {
      p_driver_profile_id: driverAProfile,
      p_display_name: "Motorista A",
      p_phone: "11966665555",
      p_active: true,
    });
    expect(reactivated.error).toBeNull();
  });

  it("bloqueia loja cruzada e entregador de outra loja", async () => {
    const order = await readyOrderAtStoreA();

    const crossStore = await clientOwnerA.rpc("assign_delivery", {
      p_order_id: order.orderId,
      p_driver_profile_id: driverBProfile,
    });
    expect(errorMessage(crossStore.error)).toContain("driver_cross_store");

    const otherStoreOwner = await clientOwnerB.rpc("assign_delivery", {
      p_order_id: order.orderId,
      p_driver_profile_id: driverBProfile,
    });
    expect(errorMessage(otherStoreOwner.error)).toContain("forbidden");

    const otherStoreDeliveries = await clientOwnerB
      .from("deliveries")
      .select("id")
      .eq("store_id", storeA);
    expect(otherStoreDeliveries.data).toEqual([]);

    const orderB = await createOrderAt(slugB, productB);
    await advanceOrder(clientOwnerB, orderB.orderId, ["accepted", "preparing", "ready"]);

    const driverAOnB = await clientOwnerB.rpc("assign_delivery", {
      p_order_id: orderB.orderId,
      p_driver_profile_id: driverAProfile,
    });
    expect(errorMessage(driverAOnB.error)).toContain("driver_cross_store");

    const driverBOnB = await clientDriverB.rpc("assign_delivery", {
      p_order_id: orderB.orderId,
      p_driver_profile_id: driverBProfile,
    });
    expect(errorMessage(driverBOnB.error)).toContain("forbidden");
  });

  it("mantém compatibilidade com o fluxo manual da loja", async () => {
    const canceledOrder = await createOrderAt(slugA, productA);
    await advanceOrder(clientOwnerA, canceledOrder.orderId, ["accepted"]);
    const assigned = await clientOwnerA.rpc("assign_delivery", {
      p_order_id: canceledOrder.orderId,
      p_driver_profile_id: driverAProfile,
    });
    const deliveryId = String((assigned.data as Record<string, unknown>).deliveryId);

    await advanceOrder(clientOwnerA, canceledOrder.orderId, ["canceled"]);

    const { data: canceledDelivery } = await admin
      .from("deliveries")
      .select("status, canceled_at")
      .eq("id", deliveryId)
      .single();
    expect(canceledDelivery?.status).toBe("canceled");
    expect(canceledDelivery?.canceled_at).not.toBeNull();

    const deliveredOrder = await readyOrderAtStoreA();
    const assigned2 = await clientOwnerA.rpc("assign_delivery", {
      p_order_id: deliveredOrder.orderId,
      p_driver_profile_id: driverAProfile,
    });
    const deliveryId2 = String((assigned2.data as Record<string, unknown>).deliveryId);

    await advanceOrder(clientOwnerA, deliveredOrder.orderId, ["out_for_delivery", "delivered"]);

    const { data: deliveredDelivery } = await admin
      .from("deliveries")
      .select("status, delivered_at")
      .eq("id", deliveryId2)
      .single();
    expect(deliveredDelivery?.status).toBe("delivered");
    expect(deliveredDelivery?.delivered_at).not.toBeNull();
  });

  it("revoga o acesso quando o vínculo de entregador é removido", async () => {
    const order = await readyOrderAtStoreA();
    const assigned = await clientOwnerA.rpc("assign_delivery", {
      p_order_id: order.orderId,
      p_driver_profile_id: driverA2Profile,
    });
    const deliveryId = String((assigned.data as Record<string, unknown>).deliveryId);

    const { error: removalError } = await admin
      .from("store_memberships")
      .delete()
      .eq("store_id", storeA)
      .eq("user_id", users[4]);

    expect(removalError).toBeNull();

    const start = await clientDriverA2.rpc("start_delivery", { p_delivery_id: deliveryId });
    expect(errorMessage(start.error)).toContain("driver_not_member");

    const orders = await clientDriverA2.from("orders").select("id").eq("id", order.orderId);
    expect(orders.data).toEqual([]);
  });

  it("protege o histórico: escrita direta e eventos imutáveis", async () => {
    const order = await readyOrderAtStoreA();
    const assigned = await clientOwnerA.rpc("assign_delivery", {
      p_order_id: order.orderId,
      p_driver_profile_id: driverAProfile,
    });
    const deliveryId = String((assigned.data as Record<string, unknown>).deliveryId);

    const directWrite = await clientOwnerA
      .from("deliveries")
      .update({ status: "delivered" })
      .eq("id", deliveryId)
      .select("id");
    expect(directWrite.error).not.toBeNull();

    const { data: events } = await admin
      .from("delivery_events")
      .select("id")
      .eq("delivery_id", deliveryId);

    expect(events).toHaveLength(1);

    const tamper = await admin
      .from("delivery_events")
      .update({ reason: "adulterado" })
      .eq("id", events![0].id)
      .select("id");

    expect(tamper.error).not.toBeNull();
    expect(errorMessage(tamper.error)).toContain("imut");

    const { data: untouched } = await admin
      .from("delivery_events")
      .select("reason")
      .eq("id", events![0].id)
      .single();
    expect(untouched?.reason).toBeNull();
  });
});
