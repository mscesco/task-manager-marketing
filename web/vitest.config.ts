// =====================================================
// vitest.config.ts -- runner de testes do front (Spec 027)
// -----------------------------------------------------
// ESCOPO: `lib/` (regras puras) E `components/` (montagem da tela).
//
// ⚠️ ATE 03/08/2026 O `include` ERA SO `lib/**`. O efeito colateral foi
// medido e e serio: os TRES portoes (tsc, npm test, next build) passavam
// com a tela inteira quebrada. A pill do card, o mapa de projetos, as
// guardas de carregamento -- nada disso era coberto por teste nenhum, e a
// unica verificacao era print de tela.
//
// Fronteira que este arquivo AINDA sustenta (Spec 027):
//   lib/        -> dominio do front: decide. Testado como funcao pura.
//   components/ -> apresentacao: desenha e MONTA. Testado por render.
// Componente nao ganha regra de negocio por ter ganhado teste -- se um
// teste de componente precisar afirmar uma REGRA, a regra esta no lugar
// errado e o teste dela pertence a `lib/`.
//
// jsdom (D2) porque `tema.ts` usa localStorage/matchMedia e `urlTarefa.ts`
// usa location/history. Sem DOM esses arquivos nem carregam.
//
// SEM `globals: true` de proposito: cada teste importa `describe/it/expect`
// de "vitest" explicitamente. Assim o tsconfig.json NAO precisa ganhar
// "types": ["vitest/globals"] -- um arquivo a menos alterado, e a origem
// dos helpers fica visivel no topo de cada teste.
// ⚠️ CONSEQUENCIA: o auto-cleanup do @testing-library NAO se registra
// sozinho (ele depende dos globals). Todo teste de componente PRECISA de
// `afterEach(cleanup)` explicito -- sem isso o segundo render encontra o
// primeiro ainda no documento e `getByText` estoura com "multiple elements".
// =====================================================
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Espelha `paths: { "@/*": ["./*"] }` do tsconfig.json. Sem isto, todo
    // `import ... from "@/lib/..."` quebra dentro do teste.
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "jsdom",
    include: [
      "lib/**/*.test.{ts,tsx}",
      "components/**/*.test.{ts,tsx}",
    ],
  },
});
