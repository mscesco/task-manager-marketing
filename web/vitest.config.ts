// =====================================================
// vitest.config.ts -- runner de testes do front (Spec 027)
// -----------------------------------------------------
// ESCOPO (Spec 027, D3): so testa as REGRAS PURAS de `lib/`. Nenhum
// componente e renderizado aqui -- renderizar TaskDetail/Board exigiria
// mockar `@/lib/api` inteiro e o contexto do dnd-kit (caro e frágil).
//
// Fronteira que este arquivo sustenta:
//   lib/        -> dominio do front: funcoes puras, testadas.
//   components/ -> apresentacao: desenha, nao decide.
//
// jsdom (D2) porque `tema.ts` usa localStorage/matchMedia e `urlTarefa.ts`
// usa location/history. Sem DOM esses arquivos nem carregam.
//
// SEM `globals: true` de proposito: cada teste importa `describe/it/expect`
// de "vitest" explicitamente. Assim o tsconfig.json NAO precisa ganhar
// "types": ["vitest/globals"] -- um arquivo a menos alterado, e a origem
// dos helpers fica visivel no topo de cada teste.
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
    // So `lib/`: mantem o escopo da spec explicito na configuracao, em vez
    // de depender de disciplina de quem escreve o proximo teste.
    include: ["lib/**/*.test.{ts,tsx}"],
  },
});
