// Testes do front: `lib/` (regras puras) e `components/` (render). `app/` fica de fora.
// jsdom porque `tema.ts` e `urlTarefa.ts` usam localStorage, matchMedia e location.
// Sem `globals: true`: o auto-cleanup do @testing-library não se registra, então
// todo teste de componente precisa de `afterEach(cleanup)` explícito.
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Espelha `paths: { "@/*": ["./*"] }` do tsconfig.json.
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "jsdom",
    // Fuso negativo fixo: em UTC (o CI) erro de data local x UTC passa verde.
    env: { TZ: "America/Sao_Paulo" },
    // Espera a destruição agendada do editor (Tiptap) antes de o jsdom sair; ver o arquivo.
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "lib/**/*.test.{ts,tsx}",
      "components/**/*.test.{ts,tsx}",
    ],
  },
});
