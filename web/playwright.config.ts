// Jornadas de ponta a ponta + axe. Roda contra um `next dev` já de pé (o dev
// repassa /api para a :8000; a CSP de produção não deixa a API em outra origem).
// No CI o workflow sobe API e web antes; localmente, use o seu dev.
// Login por E2E_EMAIL / E2E_PASSWORD.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // O dev compila cada rota na primeira visita.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    // Sem animação: o axe mediria o contraste no meio do fade de entrada.
    reducedMotion: "reduce",
  },
  // O tema segue o sistema: o axe passa nos dois.
  projects: [
    { name: "claro", use: { ...devices["Desktop Chrome"], colorScheme: "light" } },
    { name: "escuro", use: { ...devices["Desktop Chrome"], colorScheme: "dark" } },
  ],
});
