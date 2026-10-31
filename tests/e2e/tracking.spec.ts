import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const supabaseUrl = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const enabled = Boolean(supabaseUrl && anonKey && serviceRoleKey);

const password = "E2e-forte-123";

// Simulated coordinates only: this validates the browser and server flow, not a
// physical GPS device. The Playwright geolocation API replaces the device sensor.
const FIRST_POSITION = { latitude: -23.55052, longitude: -46.633308, accuracy: 8 };
const SECOND_POSITION = { latitude: -23.5511, longitude: -46.633308, accuracy: 8 };

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

test.describe("rastreamento GPS no acompanhamento", () => {
  test.describe.configure({ timeout: 300_000 });

  test("entregador compartilha, cliente vê no mapa, envio encerra na conclusão e outra loja não acessa", async ({
    browser,
  }) => {
    test.skip(!enabled, "Requer projeto Supabase de teste.");

    const admin = createClient(supabaseUrl!, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anon = createClient(supabaseUrl!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const storeSlug = `rastreio-e2e-${runId}`;
    const otherSlug = `rastreio-e2e-b-${runId}`;
    const driverName = "Motorista Rastreio E2E";
    const customerName = "Cliente Rastreio E2E";

    const userIds: string[] = [];
    const storeIds: string[] = [];

    const ownerContext = await browser.newContext();
    const driverContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      geolocation: FIRST_POSITION,
      permissions: ["geolocation"],
    });
    const customerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const otherOwnerContext = await browser.newContext();

    try {
      const ownerEmail = `rastreio-owner-${runId}@example.com`;
      const driverEmail = `rastreio-driver-${runId}@example.com`;
      const otherOwnerEmail = `rastreio-owner-b-${runId}@example.com`;

      async function createUser(email: string, name: string) {
        const result = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { name },
        });

        if (result.error || !result.data.user) {
          throw new Error(result.error?.message ?? "Falha ao criar usuário E2E.");
        }

        userIds.push(result.data.user.id);
        return result.data.user.id;
      }

      const ownerId = await createUser(ownerEmail, "Dono Rastreio E2E");
      const driverId = await createUser(driverEmail, driverName);
      const otherOwnerId = await createUser(otherOwnerEmail, "Dono B Rastreio E2E");

      const { data: stores, error: storesError } = await admin
        .from("stores")
        .insert([
          {
            name: "Rastreio E2E Store",
            slug: storeSlug,
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
            name: "Rastreio E2E Store B",
            slug: otherSlug,
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

      if (storesError || !stores) {
        throw new Error(storesError?.message ?? "Falha ao criar lojas E2E.");
      }

      const storeId = stores.find((row) => row.slug === storeSlug)!.id;
      const otherStoreId = stores.find((row) => row.slug === otherSlug)!.id;
      storeIds.push(storeId, otherStoreId);

      const { error: membershipError } = await admin.from("store_memberships").insert([
        { store_id: storeId, user_id: ownerId, role: "owner" },
        { store_id: otherStoreId, user_id: otherOwnerId, role: "owner" },
      ]);
      if (membershipError) {
        throw new Error(membershipError.message);
      }

      const { data: category, error: categoryError } = await admin
        .from("categories")
        .insert({ store_id: storeId, name: "Rastreio E2E", active: true })
        .select("id")
        .single();
      if (categoryError || !category) {
        throw new Error(categoryError?.message ?? "Falha ao criar categoria E2E.");
      }

      const { data: product, error: productError } = await admin
        .from("products")
        .insert({
          store_id: storeId,
          category_id: category.id,
          name: "Prato Rastreio E2E",
          price_cents: 2500,
          available: true,
        })
        .select("id")
        .single();
      if (productError || !product) {
        throw new Error(productError?.message ?? "Falha ao criar produto E2E.");
      }

      const ownerClient = createClient(supabaseUrl!, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const signIn = await ownerClient.auth.signInWithPassword({
        email: ownerEmail,
        password,
      });
      expect(signIn.error).toBeNull();

      const createdDriver = await ownerClient.rpc("create_driver", {
        p_store_id: storeId,
        p_user_id: driverId,
        p_display_name: driverName,
        p_phone: "11999998888",
      });
      expect(createdDriver.error).toBeNull();
      const driverProfileId = String(
        (createdDriver.data as Record<string, unknown>).driverProfileId,
      );

      const trackingToken = createHash("sha256").update(randomUUID()).digest("hex");
      const trackingTokenHash = createHash("sha256").update(trackingToken).digest("hex");
      const payload = {
        customerName,
        customerPhone: "11912345678",
        fulfillmentType: "delivery",
        address: {
          street: "Rua do Rastreio",
          number: "88",
          complement: "",
          district: "Centro",
          city: "São Paulo",
          reference: "",
          postalCode: "01000-000",
        },
        paymentMethod: "cash",
        notes: "",
        items: [{ productId: product.id, quantity: 1, notes: "", options: [] }],
      };

      // 1. O cliente faz o pedido pelo cardápio (API pública).
      const created = await anon.rpc("create_order", {
        p_store_slug: storeSlug,
        p_payload: payload,
        p_idempotency_key: randomUUID().replace(/-/g, ""),
        p_request_hash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
        p_tracking_token_hash: trackingTokenHash,
      });
      expect(created.error).toBeNull();

      const createdOrder = created.data as Record<string, unknown>;
      const orderId = String(createdOrder.orderId);
      const orderNumber = Number(createdOrder.orderNumber);
      expect(orderNumber).toBeGreaterThan(0);

      // 2. A loja aceita, prepara e marca como pronto.
      for (const status of ["accepted", "preparing", "ready"]) {
        const moved = await ownerClient.rpc("update_order_status", {
          p_order_id: orderId,
          p_new_status: status,
        });
        expect(moved.error).toBeNull();
      }

      // 3. A loja atribui o entregador.
      const assigned = await ownerClient.rpc("assign_delivery", {
        p_order_id: orderId,
        p_driver_profile_id: driverProfileId,
      });
      expect(assigned.error).toBeNull();
      const deliveryId = String((assigned.data as Record<string, unknown>).deliveryId);

      // 4. O entregador inicia a coleta pelo painel.
      const driverPage = await driverContext.newPage();
      await login(driverPage, driverEmail);
      await driverPage.goto("/entregador");
      await expect(
        driverPage.getByRole("heading", { level: 1, name: "Minhas entregas" }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(driverPage.getByText(`Pedido #${orderNumber}`)).toBeVisible({
        timeout: 20_000,
      });

      await driverPage.getByRole("button", { name: "Iniciar entrega" }).click();
      await expect(driverPage.getByText("Coleta registrada. Pedido em rota.")).toBeVisible({
        timeout: 20_000,
      });

      // 5. O entregador autoriza o GPS por ação explícita.
      const sharing = driverPage.getByTestId("location-sharing");
      await expect(sharing).toBeVisible();
      await sharing.getByRole("button", { name: "Compartilhar localização" }).click();

      // 6. O sistema transmite a posição (simulada pelo navegador de teste).
      await expect(driverPage.getByTestId("location-sharing-status")).toHaveText(
        "Localização ativa",
        { timeout: 30_000 },
      );

      const firstStored = await anon.rpc("get_order_tracking", {
        p_store_slug: storeSlug,
        p_order_number: orderNumber,
        p_tracking_token_hash: trackingTokenHash,
      });
      expect(firstStored.error).toBeNull();
      const firstLocation = (
        (firstStored.data as Record<string, unknown>).delivery as Record<string, unknown>
      ).location as Record<string, unknown>;
      expect(firstLocation.latitude).toBeCloseTo(FIRST_POSITION.latitude, 4);

      // 7. O cliente abre o acompanhamento.
      const customerPage = await customerContext.newPage();
      const workerResponse = customerPage.waitForResponse(
        (response) => response.url().includes("maplibre-gl-worker"),
        { timeout: 60_000 },
      );
      const styleResponse = customerPage.waitForResponse(
        (response) => response.url().startsWith("https://tiles.openfreemap.org/styles/liberty"),
        { timeout: 60_000 },
      );

      await customerPage.goto(`/loja/${storeSlug}/pedido/${orderNumber}#t=${trackingToken}`);
      await expect(
        customerPage.getByRole("heading", { level: 1, name: `Pedido #${orderNumber}` }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        customerPage.getByRole("heading", { name: "Localização do entregador" }),
      ).toBeVisible({
        timeout: 20_000,
      });

      // 8. O mapa mostra o marcador da última posição.
      await expect(customerPage.getByTestId("delivery-map")).toBeVisible({ timeout: 30_000 });
      await expect(customerPage.getByTestId("delivery-marker")).toBeVisible({ timeout: 30_000 });

      // O worker do MapLibre e o estilo do OpenFreeMap precisam carregar para o
      // mapa renderizar de fato, e não apenas o marcador em cima de um canvas vazio.
      const worker = await workerResponse;
      expect(worker.status()).toBe(200);
      expect((await styleResponse).status()).toBe(200);

      const firstUpdatedAt = await customerPage
        .getByTestId("delivery-location-updated-at")
        .getAttribute("data-updated-at");
      expect(firstUpdatedAt).toBeTruthy();

      // 9. Uma nova posição atualiza o marcador sem recarregar a página.
      await driverPage.waitForTimeout(9_000);
      await driverContext.setGeolocation(SECOND_POSITION);

      await expect
        .poll(
          async () => {
            const response = await anon.rpc("get_order_tracking", {
              p_store_slug: storeSlug,
              p_order_number: orderNumber,
              p_tracking_token_hash: trackingTokenHash,
            });
            const delivery = (response.data as Record<string, unknown> | null)?.delivery as
              Record<string, unknown> | undefined;
            const location = delivery?.location as Record<string, unknown> | undefined;
            return location?.latitude ?? null;
          },
          { timeout: 60_000, intervals: [2_000] },
        )
        .toBeCloseTo(SECOND_POSITION.latitude, 4);

      await customerPage.getByRole("button", { name: "Atualizar agora" }).click();
      await expect
        .poll(
          () =>
            customerPage
              .getByTestId("delivery-location-updated-at")
              .getAttribute("data-updated-at"),
          { timeout: 30_000, intervals: [1_000] },
        )
        .not.toBe(firstUpdatedAt);

      await expect(customerPage.getByTestId("delivery-marker")).toBeVisible();

      // 10. O entregador conclui a entrega.
      driverPage.once("dialog", (dialog) => void dialog.accept());
      await driverPage.getByRole("button", { name: "Confirmar entrega" }).click();
      await expect(driverPage.getByText("Entrega confirmada. Pedido concluído.")).toBeVisible({
        timeout: 20_000,
      });

      // 11. A transmissão encerra: o servidor recusa novos envios.
      const driverClient = createClient(supabaseUrl!, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const driverSignIn = await driverClient.auth.signInWithPassword({
        email: driverEmail,
        password,
      });
      expect(driverSignIn.error).toBeNull();

      const lateShare = await driverClient.rpc("share_delivery_location", {
        p_delivery_id: deliveryId,
        p_latitude: SECOND_POSITION.latitude,
        p_longitude: SECOND_POSITION.longitude,
        p_accuracy_meters: SECOND_POSITION.accuracy,
        p_recorded_at: new Date().toISOString(),
      });
      expect(lateShare.error?.message ?? "").toContain("delivery_completed");

      // 12. O cliente deixa de receber posição ativa e vê o encerramento.
      await customerPage.getByRole("button", { name: "Atualizar agora" }).click();
      await expect(customerPage.getByTestId("delivery-location-ended")).toBeVisible({
        timeout: 20_000,
      });
      await expect(customerPage.getByTestId("delivery-location")).toHaveCount(0);

      const closedTracking = await anon.rpc("get_order_tracking", {
        p_store_slug: storeSlug,
        p_order_number: orderNumber,
        p_tracking_token_hash: trackingTokenHash,
      });
      const closedDelivery = (closedTracking.data as Record<string, unknown>).delivery as Record<
        string,
        unknown
      >;
      expect(closedDelivery.status).toBe("delivered");
      expect(closedDelivery.location).toBeNull();

      // 13. A Loja B não acessa o pedido nem a posição.
      const crossStore = await anon.rpc("get_order_tracking", {
        p_store_slug: otherSlug,
        p_order_number: orderNumber,
        p_tracking_token_hash: trackingTokenHash,
      });
      expect(crossStore.data).toBeNull();

      const otherOwnerPage = await otherOwnerContext.newPage();
      await login(otherOwnerPage, otherOwnerEmail);
      await otherOwnerPage.goto("/dashboard/pedidos");
      await expect(otherOwnerPage.getByText("Nenhum pedido neste filtro")).toBeVisible({
        timeout: 20_000,
      });
      await expect(otherOwnerPage.getByText(`Pedido #${orderNumber}`)).toHaveCount(0);

      const { data: storedDelivery } = await admin
        .from("deliveries")
        .select("id, status")
        .eq("id", deliveryId)
        .single();
      expect(storedDelivery?.status).toBe("delivered");
    } finally {
      try {
        if (storeIds.length > 0) {
          await admin.from("deliveries").delete().in("store_id", storeIds);
          await admin.from("driver_profiles").delete().in("store_id", storeIds);
          await admin.from("orders").delete().in("store_id", storeIds);
          await admin.from("customers").delete().in("store_id", storeIds);
          await admin.from("products").delete().in("store_id", storeIds);
          await admin.from("categories").delete().in("store_id", storeIds);
          await admin.from("store_memberships").delete().in("store_id", storeIds);
          await admin.from("stores").delete().in("id", storeIds);
        }

        for (const userId of userIds) {
          await admin.auth.admin.deleteUser(userId);
        }
      } catch (error) {
        console.error("[tracking.e2e.cleanup]", error instanceof Error ? error.message : "erro");
      }

      for (const context of [ownerContext, driverContext, customerContext, otherOwnerContext]) {
        await context.close();
      }
    }
  });

  test("sem permissão de GPS o entregador vê o aviso e ainda conclui a entrega", async ({
    browser,
  }) => {
    test.skip(!enabled, "Requer projeto Supabase de teste.");

    const admin = createClient(supabaseUrl!, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anon = createClient(supabaseUrl!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const storeSlug = `rastreio-negado-${runId}`;
    const ownerEmail = `rastreio-negado-owner-${runId}@example.com`;
    const driverEmail = `rastreio-negado-driver-${runId}@example.com`;

    const userIds: string[] = [];
    let storeId = "";
    const driverContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });

    try {
      async function createUser(email: string, name: string) {
        const result = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { name },
        });

        if (result.error || !result.data.user) {
          throw new Error(result.error?.message ?? "Falha ao criar usuário E2E.");
        }

        userIds.push(result.data.user.id);
        return result.data.user.id;
      }

      const ownerId = await createUser(ownerEmail, "Dono Sem GPS E2E");
      const driverId = await createUser(driverEmail, "Motorista Sem GPS E2E");

      const { data: store, error: storeError } = await admin
        .from("stores")
        .insert({
          name: "Rastreio Sem GPS E2E",
          slug: storeSlug,
          active: true,
          accepting_orders: true,
          delivery_enabled: true,
          pickup_enabled: true,
          delivery_fee_cents: 0,
          min_order_cents: 0,
          payment_pix_enabled: false,
          payment_cash_enabled: true,
          payment_card_on_delivery_enabled: false,
        })
        .select("id")
        .single();

      if (storeError || !store) {
        throw new Error(storeError?.message ?? "Falha ao criar loja E2E.");
      }

      storeId = store.id;

      const { error: membershipError } = await admin
        .from("store_memberships")
        .insert({ store_id: storeId, user_id: ownerId, role: "owner" });
      if (membershipError) {
        throw new Error(membershipError.message);
      }

      const { data: category, error: categoryError } = await admin
        .from("categories")
        .insert({ store_id: storeId, name: "Sem GPS E2E", active: true })
        .select("id")
        .single();
      if (categoryError || !category) {
        throw new Error(categoryError?.message ?? "Falha ao criar categoria E2E.");
      }

      const { data: product, error: productError } = await admin
        .from("products")
        .insert({
          store_id: storeId,
          category_id: category.id,
          name: "Prato Sem GPS E2E",
          price_cents: 2000,
          available: true,
        })
        .select("id")
        .single();
      if (productError || !product) {
        throw new Error(productError?.message ?? "Falha ao criar produto E2E.");
      }

      const ownerClient = createClient(supabaseUrl!, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const ownerSignIn = await ownerClient.auth.signInWithPassword({
        email: ownerEmail,
        password,
      });
      expect(ownerSignIn.error).toBeNull();

      const createdDriver = await ownerClient.rpc("create_driver", {
        p_store_id: storeId,
        p_user_id: driverId,
        p_display_name: "Motorista Sem GPS E2E",
        p_phone: "11999997777",
      });
      expect(createdDriver.error).toBeNull();
      const driverProfileId = String(
        (createdDriver.data as Record<string, unknown>).driverProfileId,
      );

      const trackingToken = createHash("sha256").update(randomUUID()).digest("hex");
      const trackingTokenHash = createHash("sha256").update(trackingToken).digest("hex");
      const payload = {
        customerName: "Cliente Sem GPS E2E",
        customerPhone: "11912345678",
        fulfillmentType: "delivery",
        address: {
          street: "Rua Sem GPS",
          number: "10",
          complement: "",
          district: "Centro",
          city: "São Paulo",
          reference: "",
          postalCode: "01000-000",
        },
        paymentMethod: "cash",
        notes: "",
        items: [{ productId: product.id, quantity: 1, notes: "", options: [] }],
      };

      const created = await anon.rpc("create_order", {
        p_store_slug: storeSlug,
        p_payload: payload,
        p_idempotency_key: randomUUID().replace(/-/g, ""),
        p_request_hash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
        p_tracking_token_hash: trackingTokenHash,
      });
      expect(created.error).toBeNull();

      const order = created.data as Record<string, unknown>;
      const orderId = String(order.orderId);
      const orderNumber = Number(order.orderNumber);

      for (const status of ["accepted", "preparing", "ready"]) {
        const moved = await ownerClient.rpc("update_order_status", {
          p_order_id: orderId,
          p_new_status: status,
        });
        expect(moved.error).toBeNull();
      }

      const assigned = await ownerClient.rpc("assign_delivery", {
        p_order_id: orderId,
        p_driver_profile_id: driverProfileId,
      });
      expect(assigned.error).toBeNull();
      const deliveryId = String((assigned.data as Record<string, unknown>).deliveryId);

      const driverClient = createClient(supabaseUrl!, anonKey!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const driverSignIn = await driverClient.auth.signInWithPassword({
        email: driverEmail,
        password,
      });
      expect(driverSignIn.error).toBeNull();
      const started = await driverClient.rpc("start_delivery", { p_delivery_id: deliveryId });
      expect(started.error).toBeNull();

      const driverPage = await driverContext.newPage();
      await login(driverPage, driverEmail);
      await driverPage.goto("/entregador");
      await expect(driverPage.getByText(`Pedido #${orderNumber}`)).toBeVisible({
        timeout: 20_000,
      });

      await driverPage.getByRole("button", { name: "Compartilhar localização" }).click();

      // O navegador de teste não recebeu permissão de geolocalização.
      await expect(driverPage.getByTestId("location-sharing-status")).toHaveText(
        "Permissão negada",
        { timeout: 30_000 },
      );
      await expect(driverPage.getByText(/Autorize o GPS/)).toBeVisible();

      // Concluir a entrega não depende do GPS.
      driverPage.once("dialog", (dialog) => void dialog.accept());
      await driverPage.getByRole("button", { name: "Confirmar entrega" }).click();
      await expect(driverPage.getByText("Entrega confirmada. Pedido concluído.")).toBeVisible({
        timeout: 20_000,
      });

      const tracking = await anon.rpc("get_order_tracking", {
        p_store_slug: storeSlug,
        p_order_number: orderNumber,
        p_tracking_token_hash: trackingTokenHash,
      });
      const delivery = (tracking.data as Record<string, unknown>).delivery as Record<
        string,
        unknown
      >;
      expect(delivery.status).toBe("delivered");
      expect(delivery.location).toBeNull();
    } finally {
      try {
        if (storeId) {
          await admin.from("deliveries").delete().eq("store_id", storeId);
          await admin.from("driver_profiles").delete().eq("store_id", storeId);
          await admin.from("orders").delete().eq("store_id", storeId);
          await admin.from("customers").delete().eq("store_id", storeId);
          await admin.from("products").delete().eq("store_id", storeId);
          await admin.from("categories").delete().eq("store_id", storeId);
          await admin.from("store_memberships").delete().eq("store_id", storeId);
          await admin.from("stores").delete().eq("id", storeId);
        }

        for (const userId of userIds) {
          await admin.auth.admin.deleteUser(userId);
        }
      } catch (error) {
        console.error(
          "[tracking.e2e.denied.cleanup]",
          error instanceof Error ? error.message : "erro",
        );
      }

      await driverContext.close();
    }
  });
});
