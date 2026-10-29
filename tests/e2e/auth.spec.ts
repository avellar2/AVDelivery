import { expect, test } from "@playwright/test";

test("página inicial apresenta a plataforma e o acesso ao painel", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /Delivery próprio para o seu restaurante/i }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Entrar no painel" })).toBeVisible();
});

test("a página de login renderiza o formulário", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Entrar no painel" })).toBeVisible();
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await expect(page.getByLabel("Senha")).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
});

test("dashboard sem sessão redireciona para o login", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Entrar no painel" })).toBeVisible();
});

test("configurações sem sessão redireciona para o login", async ({ page }) => {
  await page.goto("/dashboard/configuracoes");

  await expect(page).toHaveURL(/\/login/);
});

test("área administrativa sem sessão redireciona para o login", async ({ page }) => {
  await page.goto("/admin");

  await expect(page).toHaveURL(/\/login/);
});

test("login com credenciais não autorizadas permanece no login e exibe erro", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("E-mail").fill(`naoexiste-${Date.now()}@example.com`);
  await page.getByLabel("Senha").fill("Senha-forte-123");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
