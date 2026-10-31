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

const BASE_LATITUDE = -23.55052;
const BASE_LONGITUDE = -46.633308;

let admin: SupabaseClient;
let anon: SupabaseClient;
let clientOwnerA: SupabaseClient;
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

function orderPayload(productId: string) {
  return {
    customerName: "Cliente Rastreio",
    customerPhone: nextPhone(),
    fulfillmentType: "delivery",
    address: {
      street: "Rua do Rastreio",
      number: "77",
      complement: "",
      district: "Centro",
      city: "São Paulo",
      reference: "",
      postalCode: "01000-000",
    },
    paymentMethod: "cash",
    notes: "",
    items: [{ productId, quantity: 1, notes: "", options: [] }],
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

async function assignDelivery(
  client: SupabaseClient,
  orderId: string,
  driverProfileId: string,
): Promise<string> {
  const response = await client.rpc("assign_delivery", {
    p_order_id: orderId,
    p_driver_profile_id: driverProfileId,
  });

  if (response.error) {
    throw new Error(`assign_delivery: ${response.error.message}`);
  }

  return String((response.data as Record<string, unknown>).deliveryId);
}

async function startDelivery(client: SupabaseClient, deliveryId: string): Promise<void> {
  const response = await client.rpc("start_delivery", { p_delivery_id: deliveryId });

  if (response.error) {
    throw new Error(`start_delivery: ${response.error.message}`);
  }
}

async function trackingFor(
  slug: string,
  orderNumber: number,
  tokenHash: string,
): Promise<Record<string, unknown>> {
  const response = await anon.rpc("get_order_tracking", {
    p_store_slug: slug,
    p_order_number: orderNumber,
    p_tracking_token_hash: tokenHash,
  });

  if (response.error) {
    throw new Error(`get_order_tracking: ${response.error.message}`);
  }

  return response.data as Record<string, unknown>;
}

function trackingDelivery(tracking: Record<string, unknown>): Record<string, unknown> {
  return (tracking.delivery ?? {}) as Record<string, unknown>;
}

async function sendLocation(
  client: SupabaseClient,
  deliveryId: string,
  overrides: Record<string, unknown> = {},
) {
  return client.rpc("share_delivery_location", {
    p_delivery_id: deliveryId,
    p_latitude: BASE_LATITUDE,
    p_longitude: BASE_LONGITUDE,
    p_accuracy_meters: 12,
    p_recorded_at: new Date().toISOString(),
    ...overrides,
  });
}

async function deliveryFor(
  driver: "a" | "a2" = "a",
  options: { start?: boolean } = {},
): Promise<CreatedOrder & { deliveryId: string }> {
  const order = await readyOrderAtStoreA();
  const driverProfileId = driver === "a" ? driverAProfile : driverA2Profile;
  const deliveryId = await assignDelivery(clientOwnerA, order.orderId, driverProfileId);

  if (options.start !== false) {
    await startDelivery(driver === "a" ? clientDriverA : clientDriverA2, deliveryId);
  }

  return { ...order, deliveryId };
}

describe.skipIf(!enabled)("rastreamento de entregas (integração real)", () => {
  beforeAll(async () => {
    admin = createClient(url!, serviceRoleKey!, clientOptions);
    anon = createClient(url!, anonKey!, clientOptions);

    async function createUser(prefix: string, name: string) {
      const email = `tracking-${prefix}-${runId}@example.com`;
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

    const ownerA = await createUser("owner-a", "Rastreio Dono A");
    const driverA = await createUser("driver-a", "Rastreio Motorista A");
    const driverA2 = await createUser("driver-a2", "Rastreio Motorista A2");
    const ownerB = await createUser("owner-b", "Rastreio Dono B");
    const driverB = await createUser("driver-b", "Rastreio Motorista B");

    slugA = `rastreio-a-${runId}`;
    slugB = `rastreio-b-${runId}`;

    const { data: createdStores, error: storesError } = await admin
      .from("stores")
      .insert([
        {
          name: "Rastreio Loja A",
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
          name: "Rastreio Loja B",
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
    clientDriverA = await signIn(driverA.email);
    clientDriverA2 = await signIn(driverA2.email);
    clientOwnerB = await signIn(ownerB.email);
    clientDriverB = await signIn(driverB.email);

    const { data: categories, error: categoriesError } = await admin
      .from("categories")
      .insert([
        { store_id: storeA, name: "Rastreio", active: true },
        { store_id: storeB, name: "Rastreio", active: true },
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
          name: "Prato Rastreio A",
          price_cents: 2000,
          available: true,
        },
        {
          store_id: storeB,
          category_id: categories.find((row) => row.store_id === storeB)!.id,
          name: "Prato Rastreio B",
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

    const createdDriverA = await clientOwnerA.rpc("create_driver", {
      p_store_id: storeA,
      p_user_id: driverA.id,
      p_display_name: "Motorista Rastreio A",
      p_phone: "11977776666",
    });
    if (createdDriverA.error) {
      throw new Error(`create_driver(a): ${createdDriverA.error.message}`);
    }
    driverAProfile = String((createdDriverA.data as Record<string, unknown>).driverProfileId);

    const createdDriverA2 = await clientOwnerA.rpc("create_driver", {
      p_store_id: storeA,
      p_user_id: driverA2.id,
      p_display_name: "Motorista Rastreio A2",
      p_phone: "11966665555",
    });
    if (createdDriverA2.error) {
      throw new Error(`create_driver(a2): ${createdDriverA2.error.message}`);
    }
    driverA2Profile = String((createdDriverA2.data as Record<string, unknown>).driverProfileId);

    const createdDriverB = await clientOwnerB.rpc("create_driver", {
      p_store_id: storeB,
      p_user_id: driverB.id,
      p_display_name: "Motorista Rastreio B",
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
      console.error("[tracking.cleanup]", error instanceof Error ? error.message : "erro");
    }
  }, 120_000);

  it("guarda a posição autorizada e o acompanhamento devolve apenas a última", async () => {
    const order = await deliveryFor("a");
    const sentAt = new Date(Date.now() - 1_000).toISOString();

    const response = await sendLocation(clientDriverA, order.deliveryId, {
      p_recorded_at: sentAt,
    });

    expect(response.error).toBeNull();
    expect((response.data as Record<string, unknown>).changed).toBe(true);

    const tracking = await trackingFor(slugA, order.orderNumber, order.tokenHash);
    const delivery = trackingDelivery(tracking);
    const location = delivery.location as Record<string, unknown>;

    expect(delivery.status).toBe("picked_up");
    expect(location.latitude).toBeCloseTo(BASE_LATITUDE, 5);
    expect(location.longitude).toBeCloseTo(BASE_LONGITUDE, 5);
    expect(location.accuracyMeters).toBe(12);
    expect(typeof location.updatedAt).toBe("string");

    const driverRead = await clientDriverA.rpc("get_driver_delivery_location", {
      p_delivery_id: order.deliveryId,
    });

    expect(driverRead.error).toBeNull();
    expect((driverRead.data as Record<string, unknown>).latitude).toBeCloseTo(BASE_LATITUDE, 5);
  });

  it("bloqueia outro entregador, outra loja e chamada anônima", async () => {
    const order = await deliveryFor("a");

    const otherDriver = await sendLocation(clientDriverB, order.deliveryId);
    expect(errorMessage(otherDriver.error)).toContain("forbidden");

    const sameStoreDriver = await sendLocation(clientDriverA2, order.deliveryId);
    expect(errorMessage(sameStoreDriver.error)).toContain("forbidden");

    const anonymous = await sendLocation(anon, order.deliveryId);
    expect(anonymous.error).not.toBeNull();

    const unauthenticatedRead = await clientDriverB.rpc("get_driver_delivery_location", {
      p_delivery_id: order.deliveryId,
    });
    expect(errorMessage(unauthenticatedRead.error)).toContain("forbidden");

    const tracking = await trackingFor(slugA, order.orderNumber, order.tokenHash);
    expect(trackingDelivery(tracking).location ?? null).toBeNull();
  });

  it("só aceita posição depois da coleta", async () => {
    const order = await deliveryFor("a", { start: false });

    const tooEarly = await sendLocation(clientDriverA, order.deliveryId);
    expect(errorMessage(tooEarly.error)).toContain("delivery_not_started");

    await startDelivery(clientDriverA, order.deliveryId);

    const afterPickup = await sendLocation(clientDriverA, order.deliveryId);
    expect(afterPickup.error).toBeNull();
  });

  it("recusa coordenadas, precisão e horário inválidos sem alterar a última posição", async () => {
    const order = await deliveryFor("a");
    const valid = await sendLocation(clientDriverA, order.deliveryId, {
      p_recorded_at: new Date(Date.now() - 2_000).toISOString(),
    });
    expect(valid.error).toBeNull();

    const cases = [
      { p_latitude: 91, expected: "invalid_coordinates" },
      { p_longitude: -181, expected: "invalid_coordinates" },
      { p_accuracy_meters: 0, expected: "invalid_accuracy" },
      { p_accuracy_meters: 20_001, expected: "invalid_accuracy" },
      {
        p_recorded_at: new Date(Date.now() - 16 * 60_000).toISOString(),
        expected: "stale_timestamp",
      },
      {
        p_recorded_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        expected: "invalid_timestamp",
      },
    ] as const;

    for (const entry of cases) {
      const { expected, ...overrides } = entry;
      const response = await sendLocation(clientDriverA, order.deliveryId, overrides);
      expect(errorMessage(response.error), expected).toContain(expected);
    }

    const stored = await clientDriverA.rpc("get_driver_delivery_location", {
      p_delivery_id: order.deliveryId,
    });

    expect((stored.data as Record<string, unknown>).latitude).toBeCloseTo(BASE_LATITUDE, 5);
  });

  it("não sobrescreve posição mais nova e aplica limite de frequência no servidor", async () => {
    const order = await deliveryFor("a");
    const firstRecordedAt = new Date(Date.now() - 10_000).toISOString();

    const first = await sendLocation(clientDriverA, order.deliveryId, {
      p_latitude: BASE_LATITUDE,
      p_longitude: BASE_LONGITUDE,
      p_recorded_at: firstRecordedAt,
    });
    expect(first.error).toBeNull();

    const older = await sendLocation(clientDriverA, order.deliveryId, {
      p_latitude: BASE_LATITUDE + 0.01,
      p_longitude: BASE_LONGITUDE + 0.01,
      p_recorded_at: new Date(Date.now() - 20_000).toISOString(),
    });
    expect((older.data as Record<string, unknown>).changed).toBe(false);
    expect((older.data as Record<string, unknown>).reason).toBe("out_of_order");

    const tooFast = await sendLocation(clientDriverA, order.deliveryId, {
      p_latitude: BASE_LATITUDE + 0.01,
      p_longitude: BASE_LONGITUDE + 0.01,
      p_recorded_at: new Date().toISOString(),
    });
    expect((tooFast.data as Record<string, unknown>).changed).toBe(false);
    expect((tooFast.data as Record<string, unknown>).reason).toBe("rate_limited");

    const tracking = await trackingFor(slugA, order.orderNumber, order.tokenHash);
    const location = trackingDelivery(tracking).location as Record<string, unknown>;

    expect(location.latitude).toBeCloseTo(BASE_LATITUDE, 5);
    expect(location.longitude).toBeCloseTo(BASE_LONGITUDE, 5);
  });

  it("encerra o compartilhamento ao concluir a entrega", async () => {
    const order = await deliveryFor("a");
    const sent = await sendLocation(clientDriverA, order.deliveryId);
    expect(sent.error).toBeNull();

    const completed = await clientDriverA.rpc("complete_delivery", {
      p_delivery_id: order.deliveryId,
    });
    expect(completed.error).toBeNull();

    const blocking = await sendLocation(clientDriverA, order.deliveryId);
    expect(errorMessage(blocking.error)).toContain("delivery_completed");

    const tracking = await trackingFor(slugA, order.orderNumber, order.tokenHash);
    const delivery = trackingDelivery(tracking);

    expect(delivery.status).toBe("delivered");
    expect(delivery.location).toBeNull();

    const driverRead = await clientDriverA.rpc("get_driver_delivery_location", {
      p_delivery_id: order.deliveryId,
    });
    expect(driverRead.data).toBeNull();
  });

  it("reatribuição revoga o envio anterior e apaga a posição", async () => {
    const order = await deliveryFor("a");
    const sent = await sendLocation(clientDriverA, order.deliveryId);
    expect(sent.error).toBeNull();

    const reassigned = await clientOwnerA.rpc("reassign_delivery", {
      p_delivery_id: order.deliveryId,
      p_new_driver_profile_id: driverA2Profile,
      p_reason: "Troca de turno",
    });
    expect(reassigned.error).toBeNull();

    const afterReassign = await sendLocation(clientDriverA, order.deliveryId);
    expect(errorMessage(afterReassign.error)).toContain("delivery_not_active");

    const previousRead = await clientDriverA.rpc("get_driver_delivery_location", {
      p_delivery_id: order.deliveryId,
    });
    expect(previousRead.data).toBeNull();

    const newDeliveryId = String((reassigned.data as Record<string, unknown>).deliveryId);

    await startDelivery(clientDriverA2, newDeliveryId);

    const newDriver = await sendLocation(clientDriverA2, newDeliveryId);
    expect(newDriver.error).toBeNull();

    const tracking = await trackingFor(slugA, order.orderNumber, order.tokenHash);
    const location = trackingDelivery(tracking).location as Record<string, unknown>;
    expect(location.latitude).toBeCloseTo(BASE_LATITUDE, 5);
  });

  it("isola lojas, token inválido e impede leitura direta da tabela privada", async () => {
    const orderA = await deliveryFor("a");
    await sendLocation(clientDriverA, orderA.deliveryId);

    const wrongToken = await trackingFor(slugA, orderA.orderNumber, newTokenHash());
    expect(wrongToken).toBeNull();

    const orderB = await createOrderAt(slugB, productB);
    await advanceOrder(clientOwnerB, orderB.orderId, ["accepted", "preparing", "ready"]);
    const deliveryB = await assignDelivery(clientOwnerB, orderB.orderId, driverBProfile);
    await startDelivery(clientDriverB, deliveryB);
    const sentB = await sendLocation(clientDriverB, deliveryB);
    expect(sentB.error).toBeNull();

    const trackingB = await trackingFor(slugB, orderB.orderNumber, orderB.tokenHash);
    expect((trackingDelivery(trackingB).location as Record<string, unknown>).latitude).toBeCloseTo(
      BASE_LATITUDE,
      5,
    );

    const crossStoreRead = await clientOwnerB.rpc("get_driver_delivery_location", {
      p_delivery_id: orderA.deliveryId,
    });
    expect(errorMessage(crossStoreRead.error)).toContain("forbidden");

    const directRead = await clientDriverA.schema("private").from("delivery_locations").select();
    expect(directRead.error).not.toBeNull();

    const directWrite = await clientDriverA
      .schema("private")
      .from("delivery_locations")
      .update({ latitude: 0 })
      .eq("delivery_id", orderA.deliveryId);
    expect(directWrite.error).not.toBeNull();
  });

  it("remover o vínculo do entregador bloqueia novos envios", async () => {
    const order = await deliveryFor("a2");

    const sent = await sendLocation(clientDriverA2, order.deliveryId);
    expect(sent.error).toBeNull();

    const { error: removalError } = await admin
      .from("store_memberships")
      .delete()
      .eq("store_id", storeA)
      .eq("user_id", users[2]);

    expect(removalError).toBeNull();

    const blocked = await sendLocation(clientDriverA2, order.deliveryId);
    expect(errorMessage(blocked.error)).toContain("driver_not_member");
  });
});
