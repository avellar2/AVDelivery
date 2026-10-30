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
let clientManagerA: SupabaseClient;
let clientEmployeeA: SupabaseClient;
let clientDriverA: SupabaseClient;
let clientOwnerB: SupabaseClient;

const users: string[] = [];
const stores: string[] = [];

let storeA = "";
let storeB = "";
let storePaused = "";
let storeInactive = "";
let storeNoDelivery = "";
let slugA = "";
let slugB = "";
let slugPaused = "";
let slugInactive = "";
let slugNoDelivery = "";
let categoryA = "";
let categoryB = "";
let productA = "";
let productCheap = "";
let productRequired = "";
let productUnavailable = "";
let productB = "";
let groupA = "";
let groupRequired = "";
let groupB = "";
let optionA1 = "";
let optionAUnavailable = "";
let optionRequired = "";
let optionB = "";

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

function orderPayload(overrides: Record<string, unknown> = {}) {
  return {
    customerName: "Cliente Teste",
    customerPhone: nextPhone(),
    fulfillmentType: "delivery",
    address: {
      street: "Rua das Flores",
      number: "120",
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

function errorMessage(error: { message: string } | null): string {
  return error?.message ?? "";
}

describe.skipIf(!enabled)("pedidos (integração real)", () => {
  beforeAll(async () => {
    admin = createClient(url!, serviceRoleKey!, clientOptions);
    anon = createClient(url!, anonKey!, clientOptions);

    async function createUser(prefix: string) {
      const email = `orders-${prefix}-${runId}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: `Pedidos ${prefix.toUpperCase()}` },
      });

      if (error || !data.user) {
        throw new Error(`createUser(${prefix}): ${error?.message ?? "erro desconhecido"}`);
      }

      users.push(data.user.id);
      return { id: data.user.id, email };
    }

    const ownerA = await createUser("owner-a");
    const managerA = await createUser("manager-a");
    const employeeA = await createUser("employee-a");
    const driverA = await createUser("driver-a");
    const ownerB = await createUser("owner-b");

    slugA = `pedidos-a-${runId}`;
    slugB = `pedidos-b-${runId}`;
    slugPaused = `pedidos-pausada-${runId}`;
    slugInactive = `pedidos-inativa-${runId}`;
    slugNoDelivery = `pedidos-sem-entrega-${runId}`;

    const { data: createdStores, error: storesError } = await admin
      .from("stores")
      .insert([
        {
          name: "Pedidos Loja A",
          slug: slugA,
          active: true,
          accepting_orders: true,
          delivery_enabled: true,
          pickup_enabled: true,
          delivery_fee_cents: 590,
          min_order_cents: 1000,
          payment_pix_enabled: true,
          payment_cash_enabled: true,
          payment_card_on_delivery_enabled: false,
          pix_key: "pix@pedidos.test",
        },
        {
          name: "Pedidos Loja B",
          slug: slugB,
          active: true,
          accepting_orders: true,
          delivery_enabled: true,
          pickup_enabled: true,
          delivery_fee_cents: 0,
          min_order_cents: 0,
          payment_pix_enabled: false,
          payment_cash_enabled: true,
        },
        {
          name: "Pedidos Loja pausada",
          slug: slugPaused,
          active: true,
          accepting_orders: false,
        },
        {
          name: "Pedidos Loja inativa",
          slug: slugInactive,
          active: false,
          accepting_orders: true,
        },
        {
          name: "Pedidos Loja sem entrega",
          slug: slugNoDelivery,
          active: true,
          accepting_orders: true,
          delivery_enabled: false,
          pickup_enabled: true,
          delivery_fee_cents: 0,
          min_order_cents: 0,
          payment_pix_enabled: true,
          pix_key: "pix@pedidos.test",
          payment_cash_enabled: false,
        },
      ])
      .select("id, slug");

    if (storesError || !createdStores) {
      throw new Error(`insert stores: ${storesError?.message ?? "sem dados"}`);
    }

    function storeId(slug: string): string {
      const store = createdStores!.find((row) => row.slug === slug);
      if (!store) {
        throw new Error(`store ${slug} não criada`);
      }
      return store.id;
    }

    storeA = storeId(slugA);
    storeB = storeId(slugB);
    storePaused = storeId(slugPaused);
    storeInactive = storeId(slugInactive);
    storeNoDelivery = storeId(slugNoDelivery);
    stores.push(storeA, storeB, storePaused, storeInactive, storeNoDelivery);

    const { error: membershipError } = await admin.from("store_memberships").insert([
      { store_id: storeA, user_id: ownerA.id, role: "owner" },
      { store_id: storeA, user_id: managerA.id, role: "manager" },
      { store_id: storeA, user_id: employeeA.id, role: "employee" },
      { store_id: storeA, user_id: driverA.id, role: "driver" },
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
    clientManagerA = await signIn(managerA.email);
    clientEmployeeA = await signIn(employeeA.email);
    clientDriverA = await signIn(driverA.email);
    clientOwnerB = await signIn(ownerB.email);

    const { data: categories, error: categoriesError } = await admin
      .from("categories")
      .insert([
        { store_id: storeA, name: "Lanches", active: true },
        { store_id: storeB, name: "Pizzas", active: true },
      ])
      .select("id, store_id");

    if (categoriesError || !categories) {
      throw new Error(`insert categories: ${categoriesError?.message ?? "sem dados"}`);
    }

    categoryA = categories.find((row) => row.store_id === storeA)!.id;
    categoryB = categories.find((row) => row.store_id === storeB)!.id;

    const { data: products, error: productsError } = await admin
      .from("products")
      .insert([
        {
          store_id: storeA,
          category_id: categoryA,
          name: "X-Bacon",
          price_cents: 2500,
          available: true,
        },
        {
          store_id: storeA,
          category_id: categoryA,
          name: "Água",
          price_cents: 500,
          available: true,
        },
        {
          store_id: storeA,
          category_id: categoryA,
          name: "Combo obrigatório",
          price_cents: 1000,
          available: true,
        },
        {
          store_id: storeA,
          category_id: categoryA,
          name: "Produto indisponível",
          price_cents: 1900,
          available: false,
        },
        {
          store_id: storeB,
          category_id: categoryB,
          name: "Pizza B",
          price_cents: 3900,
          available: true,
        },
      ])
      .select("id, name");

    if (productsError || !products) {
      throw new Error(`insert products: ${productsError?.message ?? "sem dados"}`);
    }

    productA = products.find((row) => row.name === "X-Bacon")!.id;
    productCheap = products.find((row) => row.name === "Água")!.id;
    productRequired = products.find((row) => row.name === "Combo obrigatório")!.id;
    productUnavailable = products.find((row) => row.name === "Produto indisponível")!.id;
    productB = products.find((row) => row.name === "Pizza B")!.id;

    const { data: groups, error: groupsError } = await admin
      .from("option_groups")
      .insert([
        {
          store_id: storeA,
          name: "Extras",
          min_select: 0,
          max_select: 2,
          required: false,
          active: true,
        },
        {
          store_id: storeA,
          name: "Sabor",
          min_select: 1,
          max_select: 1,
          required: true,
          active: true,
        },
        {
          store_id: storeB,
          name: "Bordas",
          min_select: 0,
          max_select: 1,
          required: false,
          active: true,
        },
      ])
      .select("id, name, store_id");

    if (groupsError || !groups) {
      throw new Error(`insert option groups: ${groupsError?.message ?? "sem dados"}`);
    }

    groupA = groups.find((row) => row.name === "Extras")!.id;
    groupRequired = groups.find((row) => row.name === "Sabor")!.id;
    groupB = groups.find((row) => row.name === "Bordas")!.id;

    const { data: options, error: optionsError } = await admin
      .from("product_options")
      .insert([
        {
          store_id: storeA,
          option_group_id: groupA,
          name: "Bacon",
          additional_price_cents: 400,
          available: true,
        },
        {
          store_id: storeA,
          option_group_id: groupA,
          name: "Queijo",
          additional_price_cents: 300,
          available: true,
        },
        {
          store_id: storeA,
          option_group_id: groupA,
          name: "Ovo indisponível",
          additional_price_cents: 200,
          available: false,
        },
        {
          store_id: storeA,
          option_group_id: groupRequired,
          name: "Cheddar",
          additional_price_cents: 300,
          available: true,
        },
        {
          store_id: storeB,
          option_group_id: groupB,
          name: "Borda recheada",
          additional_price_cents: 800,
          available: true,
        },
      ])
      .select("id, name");

    if (optionsError || !options) {
      throw new Error(`insert options: ${optionsError?.message ?? "sem dados"}`);
    }

    optionA1 = options.find((row) => row.name === "Bacon")!.id;
    optionAUnavailable = options.find((row) => row.name === "Ovo indisponível")!.id;
    optionRequired = options.find((row) => row.name === "Cheddar")!.id;
    optionB = options.find((row) => row.name === "Borda recheada")!.id;

    const { error: linksError } = await admin.from("product_option_groups").insert([
      { store_id: storeA, product_id: productA, option_group_id: groupA, sort_order: 10 },
      {
        store_id: storeA,
        product_id: productRequired,
        option_group_id: groupRequired,
        sort_order: 10,
      },
      { store_id: storeB, product_id: productB, option_group_id: groupB, sort_order: 10 },
    ]);

    if (linksError) {
      throw new Error(`insert links: ${linksError.message}`);
    }
  }, 120_000);

  afterAll(async () => {
    if (!enabled || !admin) {
      return;
    }

    try {
      if (stores.length > 0) {
        await admin.from("orders").delete().in("store_id", stores);
        await admin.from("customers").delete().in("store_id", stores);
        await admin.from("product_option_groups").delete().in("store_id", stores);
        await admin.from("product_options").delete().in("store_id", stores);
        await admin.from("products").delete().in("store_id", stores);
        await admin.from("option_groups").delete().in("store_id", stores);
        await admin.from("categories").delete().in("store_id", stores);
        await admin.from("store_memberships").delete().in("store_id", stores);
        await admin.from("stores").delete().in("id", stores);
      }

      for (const userId of users) {
        await admin.auth.admin.deleteUser(userId);
      }
    } catch (error) {
      console.error(
        "[orders.cleanup]",
        error instanceof Error ? error.message : "erro desconhecido",
      );
    }
  }, 120_000);

  it("cria o pedido completo em uma única transação com snapshots", async () => {
    const payload = orderPayload({
      items: [
        {
          productId: productA,
          quantity: 2,
          notes: "sem cebola",
          options: [{ groupId: groupA, optionId: optionA1, quantity: 1 }],
        },
      ],
    });
    const tokenHash = newTokenHash();

    const response = await createOrder(slugA, payload, newKey(), tokenHash);

    expect(response.error).toBeNull();
    const order = response.data as Record<string, unknown>;

    expect(order).toMatchObject({
      status: "pending",
      paymentStatus: "pending",
      paymentMethod: "cash",
      fulfillmentType: "delivery",
      subtotalCents: 5800,
      deliveryFeeCents: 590,
      totalCents: 6390,
      created: true,
    });

    const orderId = String(order.orderId);

    const { data: stored } = await admin
      .from("orders")
      .select("id, store_id, order_number, tracking_token_hash, request_hash")
      .eq("id", orderId)
      .single();

    expect(stored?.store_id).toBe(storeA);
    expect(stored?.tracking_token_hash).toBe(tokenHash);

    const { data: items } = await admin
      .from("order_items")
      .select("id, product_name_snapshot, unit_price_cents, quantity, total_cents, notes")
      .eq("order_id", orderId);

    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({
      product_name_snapshot: "X-Bacon",
      unit_price_cents: 2900,
      quantity: 2,
      total_cents: 5800,
      notes: "sem cebola",
    });

    const { data: optionRows } = await admin
      .from("order_item_options")
      .select("option_group_name_snapshot, option_name_snapshot, additional_price_cents, quantity")
      .eq("order_item_id", items![0].id);

    expect(optionRows).toEqual([
      {
        option_group_name_snapshot: "Extras",
        option_name_snapshot: "Bacon",
        additional_price_cents: 400,
        quantity: 1,
      },
    ]);

    const { data: events } = await admin
      .from("order_events")
      .select("previous_status, new_status, actor_id")
      .eq("order_id", orderId);

    expect(events).toEqual([{ previous_status: null, new_status: "pending", actor_id: null }]);

    const { data: customer } = await admin
      .from("customers")
      .select("name, phone")
      .eq("store_id", storeA)
      .eq("phone", String(payload.customerPhone))
      .maybeSingle();

    expect(customer).toMatchObject({ name: "Cliente Teste" });

    const tracking = await anon.rpc("get_order_tracking", {
      p_store_slug: slugA,
      p_order_number: order.orderNumber,
      p_tracking_token_hash: tokenHash,
    });

    expect(tracking.error).toBeNull();
    const tracked = tracking.data as Record<string, unknown>;
    expect(tracked.status).toBe("pending");
    expect(tracked.totalCents).toBe(6390);
    expect("trackingTokenHash" in tracked).toBe(false);
    expect("requestHash" in tracked).toBe(false);
  });

  it("ignora preços e totais enviados pelo navegador", async () => {
    const payload = orderPayload({
      totalCents: 1,
      subtotalCents: 1,
      items: [
        {
          productId: productA,
          quantity: 1,
          unitPriceCents: 1,
          totalCents: 1,
          notes: "",
          options: [{ groupId: groupA, optionId: optionA1, quantity: 1, priceCents: 1 }],
        },
      ],
    });

    const response = await createOrder(slugA, payload, newKey(), newTokenHash());

    expect(response.error).toBeNull();
    expect(response.data).toMatchObject({
      subtotalCents: 2900,
      deliveryFeeCents: 590,
      totalCents: 3490,
    });
  });

  it("repetir a mesma tentativa devolve o mesmo pedido", async () => {
    const payload = orderPayload({
      items: [{ productId: productA, quantity: 2, notes: "", options: [] }],
    });
    const key = newKey();
    const tokenHash = newTokenHash();

    const first = await createOrder(slugA, payload, key, tokenHash);
    const second = await createOrder(slugA, payload, key, tokenHash);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect((second.data as Record<string, unknown>).orderId).toBe(
      (first.data as Record<string, unknown>).orderId,
    );
    expect((second.data as Record<string, unknown>).created).toBe(false);

    const { count } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeA)
      .eq("idempotency_key", key);

    expect(count).toBe(1);
  });

  it("reutilizar a chave com conteúdo diferente gera conflito", async () => {
    const key = newKey();
    const tokenHash = newTokenHash();

    const first = await createOrder(
      slugA,
      orderPayload({ items: [{ productId: productA, quantity: 1, notes: "", options: [] }] }),
      key,
      tokenHash,
    );
    expect(first.error).toBeNull();

    const conflict = await createOrder(
      slugA,
      orderPayload({ items: [{ productId: productA, quantity: 2, notes: "", options: [] }] }),
      key,
      newTokenHash(),
    );

    expect(conflict.error).not.toBeNull();
    expect(errorMessage(conflict.error)).toContain("idempotency_conflict");
  });

  it("não duplica pedidos em tentativas simultâneas", async () => {
    const payload = orderPayload({
      items: [{ productId: productA, quantity: 1, notes: "", options: [] }],
    });
    const key = newKey();
    const tokenHash = newTokenHash();

    const [first, second] = await Promise.all([
      createOrder(slugA, payload, key, tokenHash),
      createOrder(slugA, payload, key, tokenHash),
    ]);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect((first.data as Record<string, unknown>).orderId).toBe(
      (second.data as Record<string, unknown>).orderId,
    );

    const { count } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeA)
      .eq("idempotency_key", key);

    expect(count).toBe(1);
  });

  it("rejeita produto ou adicional indisponível", async () => {
    const unavailableProduct = await createOrder(
      slugA,
      orderPayload({
        items: [{ productId: productUnavailable, quantity: 1, notes: "", options: [] }],
      }),
      newKey(),
      newTokenHash(),
    );

    expect(errorMessage(unavailableProduct.error)).toContain("product_unavailable");

    const unavailableOption = await createOrder(
      slugA,
      orderPayload({
        items: [
          {
            productId: productA,
            quantity: 1,
            notes: "",
            options: [{ groupId: groupA, optionId: optionAUnavailable, quantity: 1 }],
          },
        ],
      }),
      newKey(),
      newTokenHash(),
    );

    expect(errorMessage(unavailableOption.error)).toContain("option_unavailable");
  });

  it("rejeita adicional de outra loja ou fora do produto", async () => {
    const foreignOption = await createOrder(
      slugA,
      orderPayload({
        items: [
          {
            productId: productA,
            quantity: 1,
            notes: "",
            options: [{ groupId: groupB, optionId: optionB, quantity: 1 }],
          },
        ],
      }),
      newKey(),
      newTokenHash(),
    );

    expect(errorMessage(foreignOption.error)).toContain("option_unavailable");

    const wrongGroup = await createOrder(
      slugA,
      orderPayload({
        items: [
          {
            productId: productA,
            quantity: 1,
            notes: "",
            options: [{ groupId: groupRequired, optionId: optionRequired, quantity: 1 }],
          },
        ],
      }),
      newKey(),
      newTokenHash(),
    );

    expect(errorMessage(wrongGroup.error)).toContain("option_unavailable");
  });

  it("exige a seleção mínima do grupo obrigatório", async () => {
    const response = await createOrder(
      slugA,
      orderPayload({
        items: [{ productId: productRequired, quantity: 1, notes: "", options: [] }],
      }),
      newKey(),
      newTokenHash(),
    );

    expect(errorMessage(response.error)).toContain("selection_invalid");
  });

  it("respeita o pedido mínimo da loja", async () => {
    const response = await createOrder(
      slugA,
      orderPayload({
        items: [{ productId: productCheap, quantity: 1, notes: "", options: [] }],
      }),
      newKey(),
      newTokenHash(),
    );

    expect(errorMessage(response.error)).toContain("minimum_not_met|1000");
  });

  it("bloqueia loja pausada, inativa e formas desabilitadas", async () => {
    const paused = await createOrder(slugPaused, orderPayload(), newKey(), newTokenHash());
    expect(errorMessage(paused.error)).toContain("orders_paused");

    const inactive = await createOrder(slugInactive, orderPayload(), newKey(), newTokenHash());
    expect(errorMessage(inactive.error)).toContain("store_unavailable");

    const deliveryOff = await createOrder(slugNoDelivery, orderPayload(), newKey(), newTokenHash());
    expect(errorMessage(deliveryOff.error)).toContain("fulfillment_unavailable");

    const cashOff = await createOrder(
      slugNoDelivery,
      orderPayload({ fulfillmentType: "pickup", address: null, paymentMethod: "cash" }),
      newKey(),
      newTokenHash(),
    );
    expect(errorMessage(cashOff.error)).toContain("payment_unavailable");

    const validPickupPix = await createOrder(
      slugNoDelivery,
      orderPayload({ fulfillmentType: "pickup", address: null, paymentMethod: "pix" }),
      newKey(),
      newTokenHash(),
    );

    expect(validPickupPix.error).toBeNull();
    expect(validPickupPix.data).toMatchObject({ fulfillmentType: "pickup" });
  });

  it("isola pedidos por loja e protege PII", async () => {
    const ownerBRead = await clientOwnerB.from("orders").select("id").eq("store_id", storeA);
    expect(ownerBRead.error).toBeNull();
    expect(ownerBRead.data).toEqual([]);

    const ownerARead = await clientOwnerA.from("orders").select("id").eq("store_id", storeA);
    expect(ownerARead.error).toBeNull();
    expect(ownerARead.data?.length).toBeGreaterThan(0);

    const driverRead = await clientDriverA.from("orders").select("id").eq("store_id", storeA);
    expect(driverRead.error).toBeNull();
    expect(driverRead.data).toEqual([]);

    const anonRead = await anon.from("orders").select("id").eq("store_id", storeA);
    expect(anonRead.error).not.toBeNull();

    const anonCustomers = await anon.from("customers").select("id").eq("store_id", storeA);
    expect(anonCustomers.error).not.toBeNull();
  });

  it("aplica permissões e a máquina de estados", async () => {
    const created = await createOrder(
      slugA,
      orderPayload({
        fulfillmentType: "pickup",
        address: null,
        items: [{ productId: productA, quantity: 2, notes: "", options: [] }],
      }),
      newKey(),
      newTokenHash(),
    );
    expect(created.error).toBeNull();
    const orderId = String((created.data as Record<string, unknown>).orderId);

    const driverAttempt = await clientDriverA.rpc("update_order_status", {
      p_order_id: orderId,
      p_new_status: "accepted",
    });
    expect(errorMessage(driverAttempt.error)).toContain("forbidden");

    const jump = await clientOwnerA.rpc("update_order_status", {
      p_order_id: orderId,
      p_new_status: "delivered",
    });
    expect(errorMessage(jump.error)).toContain("invalid_status_transition");

    const accepted = await clientOwnerA.rpc("update_order_status", {
      p_order_id: orderId,
      p_new_status: "accepted",
    });
    expect(accepted.error).toBeNull();

    const preparing = await clientEmployeeA.rpc("update_order_status", {
      p_order_id: orderId,
      p_new_status: "preparing",
    });
    expect(preparing.error).toBeNull();

    const employeeCancel = await clientEmployeeA.rpc("update_order_status", {
      p_order_id: orderId,
      p_new_status: "canceled",
    });
    expect(errorMessage(employeeCancel.error)).toContain("forbidden");

    const paid = await clientManagerA.rpc("update_order_payment_status", {
      p_order_id: orderId,
      p_new_status: "paid",
    });
    expect(paid.error).toBeNull();

    const { data: afterPayment } = await admin
      .from("orders")
      .select("status, payment_status")
      .eq("id", orderId)
      .single();

    expect(afterPayment).toEqual({ status: "preparing", payment_status: "paid" });

    const employeePayment = await clientEmployeeA.rpc("update_order_payment_status", {
      p_order_id: orderId,
      p_new_status: "pending",
    });
    expect(errorMessage(employeePayment.error)).toContain("forbidden");

    const ready = await clientOwnerA.rpc("update_order_status", {
      p_order_id: orderId,
      p_new_status: "ready",
    });
    expect(ready.error).toBeNull();

    const delivered = await clientOwnerA.rpc("update_order_status", {
      p_order_id: orderId,
      p_new_status: "delivered",
    });
    expect(delivered.error).toBeNull();

    const afterDelivery = await clientOwnerA.rpc("update_order_status", {
      p_order_id: orderId,
      p_new_status: "canceled",
    });
    expect(errorMessage(afterDelivery.error)).toContain("invalid_status_transition");

    const directUpdate = await clientOwnerA
      .from("orders")
      .update({ customer_name: "Alterado" })
      .eq("id", orderId)
      .select("id");

    expect(directUpdate.error).not.toBeNull();

    const { data: events } = await admin
      .from("order_events")
      .select("new_status")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    expect(events?.map((event) => event.new_status)).toEqual([
      "pending",
      "accepted",
      "preparing",
      "ready",
      "delivered",
    ]);
  });

  it("exige o token correto para acompanhar o pedido", async () => {
    const tokenHash = newTokenHash();
    const created = await createOrder(
      slugA,
      orderPayload({
        items: [{ productId: productA, quantity: 2, notes: "", options: [] }],
      }),
      newKey(),
      tokenHash,
    );
    expect(created.error).toBeNull();
    const orderNumber = Number((created.data as Record<string, unknown>).orderNumber);

    const correct = await anon.rpc("get_order_tracking", {
      p_store_slug: slugA,
      p_order_number: orderNumber,
      p_tracking_token_hash: tokenHash,
    });
    expect(correct.error).toBeNull();
    expect(correct.data).not.toBeNull();

    const wrongToken = await anon.rpc("get_order_tracking", {
      p_store_slug: slugA,
      p_order_number: orderNumber,
      p_tracking_token_hash: newTokenHash(),
    });
    expect(wrongToken.data).toBeNull();

    const wrongStore = await anon.rpc("get_order_tracking", {
      p_store_slug: slugB,
      p_order_number: orderNumber,
      p_tracking_token_hash: tokenHash,
    });
    expect(wrongStore.data).toBeNull();

    const sequentialGuess = await anon.rpc("get_order_tracking", {
      p_store_slug: slugA,
      p_order_number: orderNumber,
      p_tracking_token_hash: "f".repeat(64),
    });
    expect(sequentialGuess.data).toBeNull();
  });

  it("limita tentativas repetidas do mesmo telefone", async () => {
    const phone = nextPhone();
    const payload = orderPayload({
      customerPhone: phone,
      items: [{ productId: productA, quantity: 2, notes: "", options: [] }],
    });

    const results = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      results.push(await createOrder(slugA, payload, newKey(), newTokenHash()));
    }

    expect(results.every((response) => response.error === null)).toBe(true);

    const blocked = await createOrder(slugA, payload, newKey(), newTokenHash());
    expect(errorMessage(blocked.error)).toContain("rate_limited");

    const unrelated = await createOrder(
      slugA,
      orderPayload({
        customerPhone: nextPhone(),
        items: [{ productId: productA, quantity: 2, notes: "", options: [] }],
      }),
      newKey(),
      newTokenHash(),
    );
    expect(unrelated.error).toBeNull();
  });
});
