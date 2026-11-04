import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const adminEmail = process.env.SUPERADMIN_EMAIL;
const adminPassword = process.env.SUPERADMIN_PASSWORD;
const supabaseUrl = process.env.SUPABASE_TEST_URL;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

const enabled = Boolean(supabaseUrl && serviceRoleKey && adminEmail && adminPassword);

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const storeName = `E2E Assinatura ${runId}`;
const storeSlug = `e2e-assinatura-${runId}`;
const ownerEmail = `e2e-subs-${runId}@example.com`;
const ownerPassword = "Teste-forte-123";

function getAdminClient(): SupabaseClient {
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

test.describe("fluxo comercial completo", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test("superadmin cria loja, teste vence, pedidos bloqueiam e acesso é regularizado", async ({
    page,
  }) => {
    test.skip(!enabled, "Requer projeto Supabase de teste e superadministrador.");

    const admin = getAdminClient();
    let ownerUserId: string | undefined;
    let storeId: string | undefined;

    try {
      const createdUser = await admin.auth.admin.createUser({
        email: ownerEmail,
        password: ownerPassword,
        email_confirm: true,
        user_metadata: { name: "Proprietário E2E Assinatura" },
      });

      if (createdUser.error || !createdUser.data.user) {
        throw new Error(createdUser.error?.message ?? "Falha ao criar proprietário de teste.");
      }

      ownerUserId = createdUser.data.user.id;

      // 1. Superadministrador cria o estabelecimento pela interface.
      await login(page, adminEmail!, adminPassword!);
      await page.goto("/admin/lojas/nova");

      await expect(page.getByRole("heading", { name: "Cadastrar estabelecimento" })).toBeVisible();
      await page.getByLabel("Nome", { exact: true }).fill(storeName);
      await page.getByLabel("Identificador público").fill(storeSlug);
      await page.getByLabel("Telefone").fill("(11) 95555-0101");
      await page.getByLabel("E-mail do proprietário").fill(ownerEmail);
      await page.getByRole("button", { name: "Criar estabelecimento" }).click();

      await expect(page).toHaveURL(/\/admin\/lojas\/[0-9a-f-]{36}$/, { timeout: 20_000 });
      storeId = page.url().split("/").pop();

      expect(storeId).toBeTruthy();
      await expect(page.getByRole("heading", { level: 1, name: storeName })).toBeVisible();
      await expect(page.getByText("Período de teste").first()).toBeVisible();
      await expect(page.getByText("Estabelecimento criado")).toBeVisible();

      // 2. Assinatura e vínculo persistidos de verdade.
      const { data: subscription, error: subscriptionError } = await admin
        .from("subscriptions")
        .select("id, status, is_exempt, trial_ends_at")
        .eq("store_id", storeId)
        .single();

      expect(subscriptionError).toBeNull();
      expect(subscription).toMatchObject({ status: "trialing", is_exempt: false });
      expect(subscription?.trial_ends_at).toBeTruthy();

      const { data: membership } = await admin
        .from("store_memberships")
        .select("role")
        .eq("store_id", storeId)
        .eq("user_id", ownerUserId)
        .single();

      expect(membership?.role).toBe("owner");

      await logout(page);

      // 3. Proprietário acessa o painel e a própria assinatura.
      await login(page, ownerEmail, ownerPassword);
      await expect(page.getByRole("heading", { level: 1, name: storeName })).toBeVisible();

      await page.goto("/dashboard/assinatura");
      await expect(page.getByRole("heading", { level: 1, name: "Assinatura" })).toBeVisible();
      await expect(page.getByText("Período de teste").first()).toBeVisible();
      await expect(page.getByText(/59,90/).first()).toBeVisible();
      await expect(page.getByText("Cobrança online")).toBeVisible();
      await expect(page.getByRole("button", { name: /Pagar agora/i })).toHaveCount(0);

      // 4. Loja opera normalmente durante o teste.
      await page.goto(`/loja/${storeSlug}`);
      await expect(page.getByRole("heading", { level: 1, name: storeName })).toBeVisible();
      await expect(page.getByText("Aceitando pedidos")).toBeVisible();

      // 5. Simula o fim do teste e da carência sem alterar o relógio do banco.
      const startedAt = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString();
      const trialEndedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const { error: expiryError } = await admin
        .from("subscriptions")
        .update({ trial_started_at: startedAt, trial_ends_at: trialEndedAt })
        .eq("store_id", storeId);

      expect(expiryError).toBeNull();

      await page.reload();
      await expect(page.getByText("Novas vendas indisponíveis").first()).toBeVisible();

      await page.goto("/dashboard");
      await expect(page.getByText("Novos pedidos bloqueados").first()).toBeVisible();
      await expect(page.getByRole("link", { name: /Ver assinatura e regularizar/i })).toBeVisible();

      await page.goto("/dashboard/assinatura");
      await expect(page.getByText("Novos pedidos bloqueados").first()).toBeVisible();
      await expect(page.getByText("Vencida").first()).toBeVisible();

      await logout(page);

      // 6. Superadministrador regulariza o acesso com motivo e auditoria.
      await login(page, adminEmail!, adminPassword!);
      await page.goto(`/admin/lojas/${storeId}`);
      await expect(page.getByText("Vencida").first()).toBeVisible();

      await page.getByLabel("Ação", { exact: true }).selectOption("activate");
      await page.getByLabel("Dias (opcional)").fill("30");
      await page
        .getByPlaceholder("Ex.: regularização de teste")
        .fill("Regularização comercial durante homologação da Etapa 6A.");
      await page.getByRole("button", { name: "Aplicar ação" }).click();

      await expect(page.getByText("Assinatura atualizada e evento registrado.")).toBeVisible();
      await expect(page.getByText("Ativa", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Assinatura ativada")).toBeVisible();

      const { data: regularized } = await admin
        .from("subscriptions")
        .select("status, is_exempt")
        .eq("store_id", storeId)
        .single();

      expect(regularized).toMatchObject({ status: "active", is_exempt: false });

      const { data: events } = await admin
        .from("subscription_events")
        .select("event_type, reason")
        .eq("store_id", storeId)
        .eq("event_type", "admin_activate");

      expect(events).toHaveLength(1);
      expect(events?.[0].reason).toContain("Regularização comercial");

      // 7. A loja volta a aceitar novos pedidos.
      await page.goto(`/loja/${storeSlug}`);
      await expect(page.getByText("Aceitando pedidos")).toBeVisible();

      await page.goto("/admin");
      await logout(page);

      await login(page, ownerEmail, ownerPassword);
      await page.goto("/dashboard");
      await expect(page.getByText("Novos pedidos bloqueados")).toHaveCount(0);

      await page.goto("/dashboard/assinatura");
      await expect(page.getByText("Ativa", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Assinatura ativada")).toBeVisible();
    } finally {
      if (storeId) {
        await admin.from("stores").delete().eq("id", storeId);
      }

      if (ownerUserId) {
        await admin.auth.admin.deleteUser(ownerUserId);
      }
    }
  });
});
