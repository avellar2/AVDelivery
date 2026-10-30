import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const supabaseUrl = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const enabled = Boolean(supabaseUrl && anonKey && serviceRoleKey);

const password = "E2e-forte-123";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

test.describe("entrega de ponta a ponta", () => {
  test.describe.configure({ timeout: 300_000 });

  test("loja cadastra entregador, atribui, coleta, entrega e o cliente acompanha", async ({
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
    const storeSlug = `entregas-e2e-${runId}`;
    const otherSlug = `entregas-e2e-b-${runId}`;
    const driverName = "Motorista E2E";
    const customerName = "Cliente Entrega E2E";

    const userIds: string[] = [];
    const storeIds: string[] = [];

    const ownerContext = await browser.newContext();
    const driverContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const customerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const otherDriverContext = await browser.newContext();
    const otherOwnerContext = await browser.newContext();

    try {
      const ownerEmail = `entregas-owner-${runId}@example.com`;
      const driverEmail = `entregas-driver-${runId}@example.com`;
      const otherDriverEmail = `entregas-driver-b-${runId}@example.com`;
      const otherOwnerEmail = `entregas-owner-b-${runId}@example.com`;

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

      const ownerId = await createUser(ownerEmail, "Dono E2E Entregas");
      await createUser(driverEmail, driverName);
      await createUser(otherDriverEmail, "Motorista de outra loja");
      const otherOwnerId = await createUser(otherOwnerEmail, "Dono B E2E");

      const { data: stores, error: storesError } = await admin
        .from("stores")
        .insert([
          {
            name: "E2E Entregas Store",
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
            name: "E2E Entregas Store B",
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
        .insert({ store_id: storeId, name: "Lanches E2E", active: true })
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
          name: "X-Entrega E2E",
          price_cents: 2500,
          available: true,
        })
        .select("id")
        .single();
      if (productError || !product) {
        throw new Error(productError?.message ?? "Falha ao criar produto E2E.");
      }

      const trackingToken = createHash("sha256").update(randomUUID()).digest("hex");
      const payload = {
        customerName,
        customerPhone: "11912345678",
        fulfillmentType: "delivery",
        address: {
          street: "Rua da Entrega",
          number: "88",
          complement: "",
          district: "Centro",
          city: "São Paulo",
          reference: "",
          postalCode: "01000-000",
        },
        paymentMethod: "cash",
        notes: "Sem cebola",
        items: [{ productId: product.id, quantity: 1, notes: "", options: [] }],
      };

      const created = await anon.rpc("create_order", {
        p_store_slug: storeSlug,
        p_payload: payload,
        p_idempotency_key: randomUUID().replace(/-/g, ""),
        p_request_hash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
        p_tracking_token_hash: createHash("sha256").update(trackingToken).digest("hex"),
      });

      if (created.error) {
        throw new Error(created.error.message);
      }

      const createdOrder = created.data as Record<string, unknown>;
      const orderNumber = Number(createdOrder.orderNumber);
      const orderId = String(createdOrder.orderId);
      expect(orderNumber).toBeGreaterThan(0);

      const ownerPage = await ownerContext.newPage();
      await login(ownerPage, ownerEmail);

      // 1. A loja cadastra o entregador vinculando uma conta existente.
      await ownerPage.goto("/dashboard/entregadores");
      await expect(
        ownerPage.getByRole("heading", { level: 1, name: "Entregadores" }),
      ).toBeVisible();
      await ownerPage.getByLabel("E-mail da conta").fill(driverEmail);
      await ownerPage.getByLabel("Nome exibido").fill(driverName);
      await ownerPage.getByLabel("Telefone (opcional)").fill("11999998888");
      await ownerPage.getByRole("button", { name: "Adicionar entregador" }).click();
      await expect(ownerPage.getByText("Entregador vinculado à loja.")).toBeVisible({
        timeout: 20_000,
      });
      await expect(ownerPage.getByRole("listitem").filter({ hasText: driverName })).toBeVisible();

      // 2. A fila do pedido é preparada até "pronto".
      await ownerPage.goto("/dashboard/pedidos");
      const orderButton = ownerPage.getByRole("button", { name: new RegExp(`#${orderNumber}`) });
      await expect(orderButton).toBeVisible({ timeout: 20_000 });
      await orderButton.click();
      await expect(
        ownerPage.getByRole("heading", { level: 2, name: `Pedido #${orderNumber}` }),
      ).toBeVisible();

      for (const [buttonName, statusLabel] of [
        ["Aceitar pedido", "Aceito"],
        ["Iniciar preparo", "Preparando"],
        ["Marcar como pronto", "Pronto"],
      ] as const) {
        await ownerPage.getByRole("button", { name: buttonName }).click();
        await expect(
          ownerPage.getByText(statusLabel, { exact: true }).filter({ visible: true }).first(),
        ).toBeVisible({ timeout: 20_000 });
      }

      // 3. A loja atribui o entregador pelo detalhe do pedido.
      await ownerPage.getByLabel("Escolher entregador").selectOption({ label: driverName });
      await ownerPage.getByRole("button", { name: "Atribuir entregador" }).click();
      await expect(ownerPage.getByText("Entregador atribuído ao pedido.")).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        ownerPage.getByText("Atribuída", { exact: true }).filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 20_000 });

      // 4. O entregador vê a entrega no celular e inicia a coleta.
      const driverPage = await driverContext.newPage();
      await login(driverPage, driverEmail);
      await driverPage.goto("/entregador");
      await expect(
        driverPage.getByRole("heading", { level: 1, name: "Minhas entregas" }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(driverPage.getByText(`Pedido #${orderNumber}`)).toBeVisible({
        timeout: 20_000,
      });
      await expect(driverPage.getByText(customerName)).toBeVisible();

      const driverOverflow = await driverPage.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(driverOverflow).toBeLessThanOrEqual(1);

      await driverPage.getByRole("button", { name: "Iniciar entrega" }).click();
      await expect(driverPage.getByText("Coleta registrada. Pedido em rota.")).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        driverPage.getByText("Em rota", { exact: true }).filter({ visible: true }).first(),
      ).toBeVisible();

      // 5. O cliente acompanha a coleta sem ver dados do entregador.
      const customerPage = await customerContext.newPage();
      await customerPage.goto(`/loja/${storeSlug}/pedido/${orderNumber}#t=${trackingToken}`);
      await expect(
        customerPage.getByRole("heading", { level: 1, name: `Pedido #${orderNumber}` }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        customerPage.getByText("O pedido foi coletado e está a caminho do seu endereço."),
      ).toBeVisible();
      await expect(
        customerPage.getByText("Em rota", { exact: true }).filter({ visible: true }).first(),
      ).toBeVisible();
      await expect(customerPage.getByText(driverName)).toHaveCount(0);

      // 6. A loja enxerga a entrega em rota.
      await ownerPage.getByRole("button", { name: "Atualizar" }).click();
      await expect(
        ownerPage.getByText("Em rota", { exact: true }).filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 20_000 });

      // 7. O entregador confirma a entrega.
      driverPage.once("dialog", (dialog) => void dialog.accept());
      await driverPage.getByRole("button", { name: "Confirmar entrega" }).click();
      await expect(driverPage.getByText("Entrega confirmada. Pedido concluído.")).toBeVisible({
        timeout: 20_000,
      });
      await expect(driverPage.getByText("Nenhuma entrega atribuída")).toBeVisible();
      await driverPage.getByRole("button", { name: /Histórico \(1\)/ }).click();
      await expect(
        driverPage.getByText("Entregue", { exact: true }).filter({ visible: true }).first(),
      ).toBeVisible();

      // 8. O cliente vê a entrega concluída.
      await customerPage.getByRole("button", { name: "Atualizar agora" }).click();
      await expect(customerPage.getByText("Entrega concluída no endereço informado.")).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        customerPage.getByText("Entregue", { exact: true }).filter({ visible: true }).first(),
      ).toBeVisible();
      await expect(customerPage.getByText("Acompanhamento encerrado")).toBeVisible();

      // 9. O pedido termina entregue na fila da loja.
      await ownerPage.getByLabel("Filtrar pedidos").selectOption("all");
      await expect(orderButton).toBeVisible();
      await orderButton.click();
      await expect(
        ownerPage.getByText("Entregue", { exact: true }).filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 20_000 });

      // 10. O banco confirma a consistência entre pedido, entrega e histórico.
      const { data: storedDelivery } = await admin
        .from("deliveries")
        .select("id, status, picked_up_at, delivered_at")
        .eq("order_id", orderId)
        .single();

      expect(storedDelivery?.status).toBe("delivered");
      expect(storedDelivery?.picked_up_at).not.toBeNull();
      expect(storedDelivery?.delivered_at).not.toBeNull();

      const { data: deliveryEvents } = await admin
        .from("delivery_events")
        .select("new_status")
        .eq("delivery_id", storedDelivery!.id)
        .order("created_at", { ascending: true });

      expect(deliveryEvents?.map((event) => event.new_status)).toEqual([
        "assigned",
        "picked_up",
        "delivered",
      ]);

      const { data: storedOrder } = await admin
        .from("orders")
        .select("status")
        .eq("id", orderId)
        .single();
      expect(storedOrder?.status).toBe("delivered");

      // 11. Entregador de outra loja não vê pedidos desta loja.
      const otherDriverPage = await otherDriverContext.newPage();
      await login(otherDriverPage, otherDriverEmail);
      await otherDriverPage.goto("/entregador");
      await expect(otherDriverPage.getByText("Nenhuma loja com acesso de entregador")).toBeVisible({
        timeout: 20_000,
      });
      await expect(otherDriverPage.getByText(`Pedido #${orderNumber}`)).toHaveCount(0);

      const otherOwnerPage = await otherOwnerContext.newPage();
      await login(otherOwnerPage, otherOwnerEmail);
      await otherOwnerPage.goto("/dashboard/pedidos");
      await expect(otherOwnerPage.getByText("Nenhum pedido neste filtro")).toBeVisible({
        timeout: 20_000,
      });

      // 12. O link de acompanhamento não expõe nome, telefone ou posição do entregador.
      await customerPage.reload();
      await expect(
        customerPage.getByRole("heading", { level: 1, name: `Pedido #${orderNumber}` }),
      ).toBeVisible({ timeout: 20_000 });
      const trackingText = (await customerPage.locator("body").innerText()).toLowerCase();
      expect(trackingText).not.toContain(driverName.toLowerCase());
      expect(trackingText).not.toContain("motorista");
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
        console.error("[deliveries.e2e.cleanup]", error instanceof Error ? error.message : "erro");
      }

      for (const context of [
        ownerContext,
        driverContext,
        customerContext,
        otherDriverContext,
        otherOwnerContext,
      ]) {
        await context.close();
      }
    }
  });
});
