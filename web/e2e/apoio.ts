import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function entrar(page: Page) {
  const email = process.env.E2E_EMAIL;
  const senha = process.env.E2E_PASSWORD;
  if (!email || !senha) throw new Error("Defina E2E_EMAIL e E2E_PASSWORD.");
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** WCAG A/AA, só impacto sério ou crítico. O overlay do Next dev fica de fora. */
export async function semViolacoes(page: Page) {
  await expect(page).toHaveTitle(/\S/); // o dev põe o <title> depois de compilar a rota
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude("nextjs-portal")
    .analyze();
  const graves = r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .flatMap((v) =>
      v.nodes.map((n) => `${v.id}: ${n.target.join(" ")} -- ${(n.failureSummary ?? "").replace(/\s+/g, " ")}`)
    );
  expect(graves, `axe em ${page.url()}`).toEqual([]);
}

/** Título único, para achar e apagar o que o teste criou (localmente o banco é o do dev). */
export const tituloE2E = (o_que: string) => `[e2e] ${o_que} ${Date.now()}`;

/** Chama a API com o token da sessão aberta na página. */
export async function api(page: Page, metodo: string, caminho: string) {
  if (page.isClosed()) return { status: 0, corpo: null }; // limpeza depois de estourar o tempo
  return page.evaluate(
    async ([m, c]) => {
      const token = localStorage.getItem("tm_access_token");
      const r = await fetch(c, { method: m, headers: { Authorization: `Bearer ${token}` } });
      return { status: r.status, corpo: r.status === 204 ? null : await r.json().catch(() => null) };
    },
    [metodo, caminho] as const
  );
}
