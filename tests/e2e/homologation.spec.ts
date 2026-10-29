import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const ownerEmail = process.env.DEMO_OWNER_EMAIL;
const ownerPassword = process.env.DEMO_OWNER_PASSWORD;
const ownerBEmail = process.env.DEMO_B_OWNER_EMAIL;
const ownerBPassword = process.env.DEMO_B_OWNER_PASSWORD;
const adminEmail = process.env.SUPERADMIN_EMAIL;
const adminPassword = process.env.SUPERADMIN_PASSWORD;
const storeASlug = process.env.DEMO_STORE_SLUG ?? "burger-homologacao";
const storeBSlug = process.env.DEMO_B_STORE_SLUG ?? "pizza-homologacao";
const supabaseUrl = process.env.SUPABASE_TEST_URL;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

const enabled = Boolean(
  supabaseUrl &&
  serviceRoleKey &&
  ownerEmail &&
  ownerPassword &&
  ownerBEmail &&
  ownerBPassword &&
  adminEmail &&
  adminPassword,
);

function getAdminClient() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Credenciais de homologação ausentes.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "Sair" }).first().click();
  await expect(page).toHaveURL(/\/login/);
}

test.describe("homologação autenticada", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(() => {
    test.skip(!enabled, "Requer projeto Supabase de teste e usuários de homologação.");
  });

  test("owner A acessa apenas a própria loja, com cookie httpOnly", async ({ page }) => {
    await login(page, ownerEmail!, ownerPassword!);

    await expect(page.getByRole("heading", { level: 1, name: "Burger Homologação" })).toBeVisible();
    await expect(page.getByText("Pizza Homologação")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Ver página pública" })).toHaveAttribute(
      "href",
      `/loja/${storeASlug}`,
    );

    const authCookies = (await page.context().cookies()).filter((cookie) =>
      cookie.name.includes("auth-token"),
    );

    expect(authCookies.length).toBeGreaterThan(0);
    expect(authCookies.every((cookie) => cookie.httpOnly)).toBe(true);

    const documentCookie = await page.evaluate(() => document.cookie);
    expect(documentCookie).not.toContain("auth-token");

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Burger Homologação" })).toBeVisible();

    await page.goto("/dashboard/configuracoes");
    await expect(page.getByRole("heading", { name: "Configurações da loja" })).toBeVisible();
    await expect(page.getByLabel("Nome da loja")).toHaveValue("Burger Homologação");

    await page.goto("/dashboard");
    await logout(page);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("owner B não enxerga a loja A", async ({ page }) => {
    await login(page, ownerBEmail!, ownerBPassword!);

    await expect(page.getByRole("heading", { level: 1, name: "Pizza Homologação" })).toBeVisible();
    await expect(page.getByText("Burger Homologação")).toHaveCount(0);

    await page.goto("/dashboard/configuracoes");
    await expect(page.getByLabel("Nome da loja")).toHaveValue("Pizza Homologação");
  });

  test("superadministrador acessa a área global", async ({ page }) => {
    await login(page, adminEmail!, adminPassword!);

    await expect(page.getByRole("heading", { name: "Nenhuma loja vinculada" })).toBeVisible();

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Estabelecimentos" })).toBeVisible();
    await expect(page.getByText("Burger Homologação").first()).toBeVisible();
    await expect(page.getByText("Pizza Homologação").first()).toBeVisible();
    await expect(page.getByText("Superadministrador").first()).toBeVisible();
  });

  test("páginas públicas exibem dados reais sem sessão", async ({ page }) => {
    await page.goto(`/loja/${storeASlug}`);
    await expect(page.getByRole("heading", { level: 1, name: "Burger Homologação" })).toBeVisible();
    await expect(page.getByText("Loja de homologação da Etapa 1.")).toBeVisible();
    await expect(page.getByText("(11) 90000-0000")).toBeVisible();
    await expect(page.getByText("Cardápio em preparação")).toBeVisible();

    await page.goto(`/loja/${storeBSlug}`);
    await expect(page.getByRole("heading", { level: 1, name: "Pizza Homologação" })).toBeVisible();
    await expect(page.getByText("Pizzaria de homologação da Etapa 1.")).toBeVisible();
  });

  test("link de recuperação cria sessão e permite redefinir a senha", async ({ page }) => {
    const admin = getAdminClient();
    const email = `homolog-recovery-${Date.now()}@example.com`;
    const initialPassword = "Inicial-forte-123";
    const newPassword = "Redefinida-forte-456";
    let userId: string | undefined;

    try {
      const created = await admin.auth.admin.createUser({
        email,
        password: initialPassword,
        email_confirm: true,
        user_metadata: { name: "Recovery Homolog" },
      });

      if (created.error || !created.data.user) {
        throw new Error(created.error?.message ?? "Falha ao criar usuário de recuperação.");
      }

      userId = created.data.user.id;

      const link = await admin.auth.admin.generateLink({ type: "recovery", email });

      if (link.error || !link.data.properties?.hashed_token) {
        throw new Error(link.error?.message ?? "Falha ao gerar link de recuperação.");
      }

      await page.goto(
        `/auth/confirm?token_hash=${encodeURIComponent(link.data.properties.hashed_token)}&type=recovery&next=/reset-password`,
      );

      await expect(page).toHaveURL(/\/reset-password/);
      await expect(page.getByRole("heading", { name: "Definir nova senha" })).toBeVisible();

      await page.getByLabel("Nova senha", { exact: true }).fill(newPassword);
      await page.getByLabel("Confirmar nova senha", { exact: true }).fill(newPassword);
      await page.getByRole("button", { name: "Salvar nova senha" }).click();

      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.getByRole("heading", { name: "Nenhuma loja vinculada" })).toBeVisible();

      await logout(page);
      await login(page, email, newPassword);
      await expect(page.getByRole("heading", { name: "Nenhuma loja vinculada" })).toBeVisible();
    } finally {
      if (userId) {
        await admin.auth.admin.deleteUser(userId);
      }
    }
  });
});
