import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

const supabaseUrl = process.env.SUPABASE_TEST_URL;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const enabled = Boolean(supabaseUrl && serviceRoleKey);

const PRODUCT_IMAGE_BUCKET = "product-images";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

test.describe("cardápio digital", () => {
  test.describe.configure({ timeout: 180_000 });

  test("gestor cria categoria, produto, imagem, adicionais e vê o cardápio público", async ({
    page,
  }) => {
    test.skip(!enabled, "Requer projeto Supabase de teste.");

    const admin = createClient(supabaseUrl!, serviceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const email = `menu-e2e-${runId}@example.com`;
    const password = "E2e-forte-123";
    const storeSlug = `menu-e2e-${runId}`;
    const storeName = "E2E Menu Store";
    const categoryName = "Hambúrgueres E2E";
    const productName = "X-Bacon E2E";
    const groupName = "Extras E2E";
    const optionName = "Bacon extra";

    let userId = "";
    let storeId = "";

    try {
      const createdUser = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: "Gestor E2E" },
      });

      if (createdUser.error || !createdUser.data.user) {
        throw new Error(createdUser.error?.message ?? "Falha ao criar usuário E2E.");
      }

      userId = createdUser.data.user.id;

      const createdStore = await admin
        .from("stores")
        .insert({
          name: storeName,
          slug: storeSlug,
          description: "Loja criada pelo teste E2E do cardápio.",
          phone: "(11) 95555-4444",
          active: true,
        })
        .select("id")
        .single();

      if (createdStore.error || !createdStore.data) {
        throw new Error(createdStore.error?.message ?? "Falha ao criar loja E2E.");
      }

      storeId = createdStore.data.id;

      const membership = await admin.from("store_memberships").insert({
        store_id: storeId,
        user_id: userId,
        role: "owner",
      });

      if (membership.error) {
        throw new Error(membership.error.message);
      }

      await login(page, email, password);
      await page.goto("/dashboard/produtos");
      await expect(page.getByRole("heading", { name: "Cardápio digital" })).toBeVisible();

      await page.getByRole("tab", { name: /Categorias/ }).click();
      await page.getByLabel("Nome da categoria").fill(categoryName);
      await page.getByLabel("Descrição").first().fill("Hambúrgueres artesanais.");
      await page.getByRole("button", { name: "Criar categoria" }).click();
      await expect(page.getByRole("heading", { name: categoryName })).toBeVisible({
        timeout: 30_000,
      });

      await page.getByRole("tab", { name: /Produtos/ }).click();
      await page.getByLabel("Nome do produto").fill(productName);
      await page.locator("#product-new-category").selectOption({ label: categoryName });
      await page.getByLabel("Preço (R$)").first().fill("25,00");
      await page.getByLabel("Descrição").first().fill("Pão, blend, bacon e queijo.");
      await page.getByRole("button", { name: "Criar produto" }).click();
      await expect(page.getByRole("heading", { name: productName })).toBeVisible({
        timeout: 30_000,
      });

      await page.getByText("Editar produto, imagem e adicionais", { exact: true }).click();

      const imageBuffer = await sharp({
        create: {
          width: 2,
          height: 2,
          channels: 3,
          background: { r: 234, g: 88, b: 12 },
        },
      })
        .png()
        .toBuffer();

      await page.getByLabel("Imagem do produto").setInputFiles({
        name: "product.png",
        mimeType: "image/png",
        buffer: imageBuffer,
      });
      await expect(page.getByAltText(`Imagem de ${productName}`).first()).toBeVisible({
        timeout: 30_000,
      });

      await page.getByRole("tab", { name: /Adicionais/ }).click();
      await page.getByLabel("Nome do grupo").first().fill(groupName);
      await page.getByLabel("Mínimo de seleções").fill("0");
      await page.getByLabel("Máximo de seleções").fill("1");
      await page.getByRole("button", { name: "Criar grupo" }).click();
      await expect(page.getByRole("heading", { name: groupName })).toBeVisible({ timeout: 30_000 });

      await page.locator("summary").filter({ hasText: "Adicionar adicional" }).click();
      await page.getByLabel("Nome do adicional").fill(optionName);
      await page.getByLabel("Preço extra (R$)").first().fill("4,00");
      await page.getByRole("button", { name: "Adicionar adicional" }).click();
      await expect(page.getByText(optionName, { exact: true })).toBeVisible({ timeout: 30_000 });

      await page.getByLabel("Associar a um produto").selectOption({ label: productName });
      await page.getByRole("button", { name: "Associar grupo" }).click();
      await expect(page.getByText("Grupo associado ao produto.")).toBeVisible({ timeout: 30_000 });

      await page.goto(`/loja/${storeSlug}`);
      await expect(page.getByRole("heading", { level: 1, name: storeName })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole("heading", { level: 2, name: categoryName })).toBeVisible();
      await expect(page.getByRole("heading", { level: 3, name: productName })).toBeVisible();
      await expect(page.getByText(/25,00/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Personalizar" })).toBeVisible();

      const publicImage = page.getByAltText(`Foto de ${productName}`);
      await expect(publicImage).toBeVisible();
      await expect
        .poll(
          async () => publicImage.evaluate((image) => (image as HTMLImageElement).naturalWidth),
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0);

      await page.getByRole("button", { name: "Personalizar" }).click();
      await expect(page.getByText(groupName)).toBeVisible();
      await expect(page.getByText(optionName)).toBeVisible();
      await expect(page.getByText(/4,00/)).toBeVisible();

      await page.getByRole("checkbox", { name: new RegExp(optionName) }).check();
      await expect(page.getByText(/29,00/)).toBeVisible();
      await expect(page.getByText(/carrinho/i)).toHaveCount(0);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(page.getByRole("heading", { level: 3, name: productName })).toBeVisible();

      const horizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(horizontalOverflow).toBeLessThanOrEqual(1);
    } finally {
      try {
        if (storeId) {
          const { data: products } = await admin
            .from("products")
            .select("image_path")
            .eq("store_id", storeId);

          const imagePaths = (products ?? [])
            .map((product) => product.image_path)
            .filter((path): path is string => Boolean(path));

          if (imagePaths.length > 0) {
            await admin.storage.from(PRODUCT_IMAGE_BUCKET).remove(imagePaths);
          }

          await admin.from("product_option_groups").delete().eq("store_id", storeId);
          await admin.from("product_options").delete().eq("store_id", storeId);
          await admin.from("products").delete().eq("store_id", storeId);
          await admin.from("option_groups").delete().eq("store_id", storeId);
          await admin.from("categories").delete().eq("store_id", storeId);
          await admin.from("stores").delete().eq("id", storeId);
        }

        if (userId) {
          await admin.auth.admin.deleteUser(userId);
        }
      } catch (error) {
        console.error(
          "[menu.e2e.cleanup]",
          error instanceof Error ? error.message : "erro desconhecido",
        );
      }
    }
  });
});
