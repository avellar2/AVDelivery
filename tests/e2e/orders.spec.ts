import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const supabaseUrl = process.env.SUPABASE_TEST_URL;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const enabled = Boolean(supabaseUrl && serviceRoleKey);

const password = "E2e-forte-123";

async function login(page: Page, email: string, userPassword: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(userPassword);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

test.describe("pedidos de ponta a ponta", () => {
  test.describe.configure({ timeout: 240_000 });

  test("cliente pede sem login, loja opera e o acompanhamento reflete o status", async ({
    browser,
  }) => {
    test.skip(!enabled, "Requer projeto Supabase de teste.");

    const admin = createClient(supabaseUrl!, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const storeSlug = `pedidos-e2e-${runId}`;
    const storeName = "E2E Pedidos Store";
    const otherSlug = `pedidos-e2e-b-${runId}`;
    const customerName = "Cliente E2E";
    const customerPhone = "(11) 98888-7777";

    const userIds: string[] = [];
    const storeIds: string[] = [];

    const customerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const ownerContext = await browser.newContext();
    const otherContext = await browser.newContext();

    try {
      const ownerEmail = `pedidos-owner-${runId}@example.com`;
      const otherEmail = `pedidos-other-${runId}@example.com`;

      const owner = await admin.auth.admin.createUser({
        email: ownerEmail,
        password,
        email_confirm: true,
        user_metadata: { name: "Dono E2E" },
      });
      if (owner.error || !owner.data.user) {
        throw new Error(owner.error?.message ?? "Falha ao criar dono E2E.");
      }
      userIds.push(owner.data.user.id);

      const other = await admin.auth.admin.createUser({
        email: otherEmail,
        password,
        email_confirm: true,
        user_metadata: { name: "Outro Dono E2E" },
      });
      if (other.error || !other.data.user) {
        throw new Error(other.error?.message ?? "Falha ao criar outro dono E2E.");
      }
      userIds.push(other.data.user.id);
      const otherUserId = other.data.user.id;

      const { data: stores, error: storesError } = await admin
        .from("stores")
        .insert([
          {
            name: storeName,
            slug: storeSlug,
            description: "Loja do teste E2E de pedidos.",
            phone: "(11) 95555-4444",
            active: true,
            accepting_orders: true,
            delivery_enabled: true,
            pickup_enabled: true,
            delivery_fee_cents: 590,
            min_order_cents: 0,
            payment_pix_enabled: true,
            pix_key: "pix@e2e.test",
            payment_cash_enabled: true,
            payment_card_on_delivery_enabled: true,
          },
          {
            name: "E2E Pedidos Store B",
            slug: otherSlug,
            active: true,
            accepting_orders: true,
          },
        ])
        .select("id, slug");

      if (storesError || !stores) {
        throw new Error(storesError?.message ?? "Falha ao criar lojas E2E.");
      }

      const storeId = stores.find((row) => row.slug === storeSlug)!.id;
      const otherStoreId = stores.find((row) => row.slug === otherSlug)!.id;
      storeIds.push(storeId, otherStoreId);

      const memberships = await admin.from("store_memberships").insert([
        { store_id: storeId, user_id: owner.data.user.id, role: "owner" },
        { store_id: otherStoreId, user_id: otherUserId, role: "owner" },
      ]);
      if (memberships.error) {
        throw new Error(memberships.error.message);
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
          name: "X-Bacon E2E",
          description: "Produto do teste de pedidos.",
          price_cents: 2500,
          available: true,
        })
        .select("id")
        .single();
      if (productError || !product) {
        throw new Error(productError?.message ?? "Falha ao criar produto E2E.");
      }

      const { data: group, error: groupError } = await admin
        .from("option_groups")
        .insert({
          store_id: storeId,
          name: "Extras E2E",
          min_select: 0,
          max_select: 1,
          required: false,
          active: true,
        })
        .select("id")
        .single();
      if (groupError || !group) {
        throw new Error(groupError?.message ?? "Falha ao criar grupo E2E.");
      }

      const { error: optionError } = await admin.from("product_options").insert({
        store_id: storeId,
        option_group_id: group.id,
        name: "Bacon extra",
        additional_price_cents: 400,
        available: true,
      });
      if (optionError) {
        throw new Error(optionError.message);
      }

      const { error: linkError } = await admin.from("product_option_groups").insert({
        store_id: storeId,
        product_id: product.id,
        option_group_id: group.id,
        sort_order: 10,
      });
      if (linkError) {
        throw new Error(linkError.message);
      }

      const customerPage = await customerContext.newPage();
      await customerPage.goto(`/loja/${storeSlug}`);
      await expect(customerPage.getByRole("heading", { level: 1, name: storeName })).toBeVisible({
        timeout: 30_000,
      });

      const overflow = await customerPage.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);

      await customerPage.getByRole("button", { name: "Personalizar" }).click();
      await customerPage.getByRole("checkbox", { name: /Bacon extra/ }).check();
      await customerPage.getByRole("button", { name: "Adicionar ao carrinho" }).click();
      await customerPage.getByRole("button", { name: "Ver carrinho" }).click();

      const dialog = customerPage.getByRole("dialog", { name: "Carrinho e checkout" });
      await expect(dialog.getByText("X-Bacon E2E")).toBeVisible();

      await dialog.getByRole("button", { name: "Continuar para o checkout" }).click();
      await dialog.getByLabel("Nome", { exact: true }).fill(customerName);
      await dialog.getByLabel("WhatsApp / telefone").fill(customerPhone);

      await dialog.getByLabel("Rua", { exact: true }).fill("Rua das Flores");
      await dialog.getByLabel("Número", { exact: true }).fill("120");
      await dialog.getByLabel("Bairro", { exact: true }).fill("Centro");
      await dialog.getByLabel("Cidade", { exact: true }).fill("São Paulo");
      await dialog.getByRole("radio", { name: /Dinheiro na entrega/ }).check();

      await dialog.getByRole("button", { name: "Revisar pedido" }).click();
      await expect(dialog.getByText("Entrega e pagamento")).toBeVisible();
      await expect(dialog.getByText("Rua das Flores, 120")).toBeVisible();

      await dialog.getByRole("button", { name: "Confirmar pedido" }).click();

      const confirmationText = dialog.getByText(/Pedido #\d+ confirmado!/);
      await expect(confirmationText).toBeVisible({ timeout: 30_000 });

      const confirmationLabel = await confirmationText.textContent();
      const orderNumber = Number(confirmationLabel?.match(/#(\d+)/)?.[1]);
      expect(orderNumber).toBeGreaterThan(0);

      await expect(
        dialog.getByRole("link", { name: "Falar com a loja no WhatsApp" }),
      ).toBeVisible();

      const trackingHref = await dialog
        .getByRole("link", { name: "Acompanhar pedido" })
        .getAttribute("href");

      expect(trackingHref).toContain(`/loja/${storeSlug}/pedido/${orderNumber}#t=`);
      expect(trackingHref).toMatch(/#t=[0-9a-f]{64}$/);

      const ownerPage = await ownerContext.newPage();
      await login(ownerPage, ownerEmail, password);
      await ownerPage.goto("/dashboard/pedidos");
      await expect(ownerPage.getByRole("heading", { level: 1, name: "Pedidos" })).toBeVisible();
      await expect(ownerPage.getByText(`#${orderNumber}`)).toBeVisible({ timeout: 20_000 });
      await expect(ownerPage.getByText(customerName)).toBeVisible();

      await ownerPage.getByRole("button", { name: new RegExp(`#${orderNumber}`) }).click();
      await expect(
        ownerPage.getByRole("heading", { level: 2, name: `Pedido #${orderNumber}` }),
      ).toBeVisible();
      await expect(ownerPage.getByText("X-Bacon E2E")).toBeVisible();
      await expect(ownerPage.getByText("Dinheiro na entrega")).toBeVisible();

      await customerPage.goto(trackingHref!);
      await expect(
        customerPage.getByRole("heading", { level: 1, name: `Pedido #${orderNumber}` }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        customerPage.getByText("Aguardando a confirmação do estabelecimento."),
      ).toBeVisible();

      async function advance(
        buttonName: string,
        expectedOwnerStatus: string,
        expectedCustomerText: string,
      ) {
        await ownerPage.getByRole("button", { name: buttonName }).click();
        await expect(ownerPage.getByText(expectedOwnerStatus, { exact: true }).first()).toBeVisible(
          { timeout: 20_000 },
        );

        await customerPage.getByRole("button", { name: "Atualizar agora" }).click();
        await expect(customerPage.getByText(expectedCustomerText)).toBeVisible({
          timeout: 20_000,
        });
      }

      await advance("Aceitar pedido", "Aceito", "Pedido aceito. Em breve o preparo começa.");
      await advance("Iniciar preparo", "Preparando", "Seu pedido está sendo preparado.");
      await advance(
        "Marcar como pronto",
        "Pronto",
        "Pedido pronto. Ele sairá para entrega em breve.",
      );
      await advance("Saiu para entrega", "Em entrega", "O pedido saiu para entrega.");
      await advance("Marcar como entregue", "Entregue", "Pedido entregue. Bom apetite!");

      await ownerPage.getByRole("button", { name: "Marcar como pago" }).click();
      await expect(ownerPage.getByText("Pago", { exact: true }).first()).toBeVisible({
        timeout: 20_000,
      });

      const { data: storedOrder } = await admin
        .from("orders")
        .select("status, payment_status, tracking_token_hash, idempotency_key")
        .eq("store_id", storeId)
        .eq("order_number", orderNumber)
        .single();

      expect(storedOrder?.status).toBe("delivered");
      expect(storedOrder?.payment_status).toBe("paid");
      expect(storedOrder?.tracking_token_hash).toMatch(/^[0-9a-f]{64}$/);

      const otherPage = await otherContext.newPage();
      await login(otherPage, otherEmail, password);
      await otherPage.goto("/dashboard/pedidos");
      await expect(otherPage.getByText("Nenhum pedido neste filtro")).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        otherPage.getByRole("heading", { level: 2, name: `Pedido #${orderNumber}` }),
      ).toHaveCount(0);

      // Segundo pedido: retirada no local com Pix manual, sem gateway.
      await customerPage.goto(`/loja/${storeSlug}`);
      await expect(customerPage.getByRole("heading", { level: 1, name: storeName })).toBeVisible({
        timeout: 30_000,
      });

      await customerPage.getByRole("button", { name: "Personalizar" }).click();
      await customerPage.getByRole("button", { name: "Adicionar ao carrinho" }).click();
      await customerPage.getByRole("button", { name: "Ver carrinho" }).click();

      const pickupDialog = customerPage.getByRole("dialog", { name: "Carrinho e checkout" });
      await pickupDialog.getByRole("button", { name: "Continuar para o checkout" }).click();
      await pickupDialog.getByLabel("Nome", { exact: true }).fill(customerName);
      await pickupDialog.getByLabel("WhatsApp / telefone").fill(customerPhone);
      await pickupDialog.getByRole("radio", { name: /Retirada no local/ }).check();
      await pickupDialog.getByRole("radio", { name: /Pix manual/ }).check();

      await expect(pickupDialog.getByText("Chave Pix: pix@e2e.test").first()).toBeVisible();
      await expect(pickupDialog.getByLabel("Rua", { exact: true })).toHaveCount(0);

      await pickupDialog.getByRole("button", { name: "Revisar pedido" }).click();
      await expect(pickupDialog.getByText("Retirada", { exact: true })).toBeVisible();
      await expect(pickupDialog.getByText("Pix manual", { exact: true })).toBeVisible();
      await expect(pickupDialog.getByText("Chave Pix: pix@e2e.test").first()).toBeVisible();
      await expect(pickupDialog.getByText("Taxa de entrega")).toBeVisible();

      await pickupDialog.getByRole("button", { name: "Confirmar pedido" }).click();

      const pickupConfirmation = pickupDialog.getByText(/Pedido #\d+ confirmado!/);
      await expect(pickupConfirmation).toBeVisible({ timeout: 30_000 });
      const pickupNumber = Number((await pickupConfirmation.textContent())?.match(/#(\d+)/)?.[1]);
      expect(pickupNumber).toBeGreaterThan(orderNumber);
      await expect(pickupDialog.getByText("Chave Pix: pix@e2e.test").first()).toBeVisible();

      const pickupTrackingHref = await pickupDialog
        .getByRole("link", { name: "Acompanhar pedido" })
        .getAttribute("href");
      expect(pickupTrackingHref).toContain(`/loja/${storeSlug}/pedido/${pickupNumber}#t=`);
      expect(pickupTrackingHref).toMatch(/#t=[0-9a-f]{64}$/);

      const { data: pickupOrder } = await admin
        .from("orders")
        .select(
          "fulfillment_type, payment_method, payment_status, delivery_address_snapshot, total_cents",
        )
        .eq("store_id", storeId)
        .eq("order_number", pickupNumber)
        .single();

      expect(pickupOrder?.fulfillment_type).toBe("pickup");
      expect(pickupOrder?.payment_method).toBe("pix");
      expect(pickupOrder?.payment_status).toBe("pending");
      expect(pickupOrder?.delivery_address_snapshot).toBeNull();
      expect(pickupOrder?.total_cents).toBe(2500);

      await ownerPage.getByRole("button", { name: "Atualizar" }).click();
      await expect(ownerPage.getByText(`#${pickupNumber}`)).toBeVisible({ timeout: 20_000 });
      await ownerPage.getByRole("button", { name: new RegExp(`#${pickupNumber}`) }).click();
      await expect(
        ownerPage.getByRole("heading", { level: 2, name: `Pedido #${pickupNumber}` }),
      ).toBeVisible();
      await expect(ownerPage.getByText("Retirada", { exact: true }).first()).toBeVisible();
      await expect(ownerPage.getByText("Pix manual", { exact: true }).first()).toBeVisible();

      await customerPage.goto(pickupTrackingHref!);
      await expect(
        customerPage.getByRole("heading", { level: 1, name: `Pedido #${pickupNumber}` }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(customerPage.getByText("Retirada", { exact: true }).first()).toBeVisible();
      await expect(customerPage.getByText("Pix manual", { exact: true }).first()).toBeVisible();
    } finally {
      try {
        if (storeIds.length > 0) {
          await admin.from("orders").delete().in("store_id", storeIds);
          await admin.from("customers").delete().in("store_id", storeIds);
          await admin.from("product_option_groups").delete().in("store_id", storeIds);
          await admin.from("product_options").delete().in("store_id", storeIds);
          await admin.from("products").delete().in("store_id", storeIds);
          await admin.from("option_groups").delete().in("store_id", storeIds);
          await admin.from("categories").delete().in("store_id", storeIds);
          await admin.from("store_memberships").delete().in("store_id", storeIds);
          await admin.from("stores").delete().in("id", storeIds);
        }

        for (const userId of userIds) {
          await admin.auth.admin.deleteUser(userId);
        }
      } catch (error) {
        console.error("[orders.e2e.cleanup]", error instanceof Error ? error.message : "erro");
      }

      await customerContext.close();
      await ownerContext.close();
      await otherContext.close();
    }
  });
});
