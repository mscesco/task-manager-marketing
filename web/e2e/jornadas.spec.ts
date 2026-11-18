// As jornadas principais, cada uma com o axe nas telas por onde passa.
import { expect, test } from "@playwright/test";
import { api, entrar, semViolacoes, tituloE2E } from "./apoio";

test("login: a tela de entrar e o início", async ({ page }) => {
  await page.goto("/login");
  await semViolacoes(page);
  await entrar(page);
  await expect(page).toHaveURL(/\/inicio/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Início");
  await semViolacoes(page);
});

test("quadro: criar tarefa, abrir, comentar e achar em Minhas tarefas", async ({ page }) => {
  await entrar(page);
  await page.goto("/quadro");
  await expect(page.getByRole("heading", { name: "Quadro Geral", level: 1 })).toBeVisible();
  await semViolacoes(page);

  const titulo = tituloE2E("tarefa");
  await page.getByRole("button", { name: "+ Nova tarefa" }).click();
  const modal = page.getByRole("dialog");
  await semViolacoes(page);
  await modal.getByLabel("Título").fill(titulo);
  // Responsável é obrigatório; quem está logado, para a tarefa cair em Minhas tarefas.
  const eu = (await api(page, "GET", "/api/v1/auth/me")).corpo.name as string;
  await modal.getByRole("button", { name: "Designar responsável" }).click();
  await modal.getByPlaceholder("Buscar pessoa…").fill(eu);
  await modal.getByRole("checkbox", { name: eu }).check();
  await modal.getByRole("button", { name: "Criar tarefa" }).click();
  const card = page.getByText(titulo);
  await expect(card).toBeVisible();

  try {
    await card.click();
    await expect(page.getByRole("heading", { name: titulo })).toBeVisible();
    await semViolacoes(page);
    const comentario = `comentário ${Date.now()}`;
    await page.getByRole("textbox", { name: /coment/i }).fill(comentario);
    await page.getByRole("button", { name: /^Comentar|^Enviar/ }).click();
    await expect(page.getByText(comentario)).toBeVisible();

    await page.goto("/minhas-tarefas");
    await expect(page.getByText(titulo)).toBeVisible();
    await semViolacoes(page);
  } finally {
    const lista = await api(page, "GET", `/api/v1/tasks?q=${encodeURIComponent(titulo)}&size=10`);
    for (const t of lista.corpo?.items ?? []) await api(page, "DELETE", `/api/v1/tasks/${t.id}`);
  }
});

test("base: criar, editar uma célula e reabrir", async ({ page }) => {
  await entrar(page);
  await page.goto("/bases");
  await expect(page.getByRole("heading", { name: "Bases", level: 1 })).toBeVisible();
  await semViolacoes(page);

  await page.getByRole("button", { name: "Nova base", exact: true }).click();
  await page.getByRole("textbox", { name: "Nome" }).fill(tituloE2E("base"));
  await page.getByRole("button", { name: "Criar base" }).click();
  await page.waitForURL(/\/bases\/[0-9a-f-]{36}/);
  const baseId = page.url().match(/\/bases\/([0-9a-f-]{36})/)![1];
  try {
    await semViolacoes(page);
    const valor = tituloE2E("linha");
    await page.getByRole("button", { name: "Nova linha" }).click();
    const celula = page.locator("[data-celula]").first();
    await celula.click();
    await page.keyboard.type(valor);
    await page.keyboard.press("Enter");
    await expect(page.getByText(valor)).toBeVisible();
    await page.reload();
    await expect(page.getByText(valor)).toBeVisible();
  } finally {
    await api(page, "DELETE", `/api/v1/bases/${baseId}`);
  }
});

test("formulário público: a lista e o formulário, sem login", async ({ page }) => {
  await page.goto("/solicitar");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await semViolacoes(page);
  const primeiro = page.locator("main a[href^='/solicitar/']").first();
  if (await primeiro.count()) {
    await primeiro.click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await semViolacoes(page);
  }
});
