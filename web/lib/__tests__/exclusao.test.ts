// Exclusao de tarefa (Spec 031, C5).
//
// ⚠️ Isto cobre o AVISO, nao a exclusao. O caminho destrutivo em si
// (TaskDetail -> deleteTask -> soft-delete cascateado) e fiacao de componente
// e NAO tem teste automatico neste projeto: o vitest.config.ts limita o
// `include` a `lib/**`. A conferencia daquilo e a mao.
import { describe, expect, it } from "vitest";

import { mensagemExclusao } from "@/lib/exclusao";

describe("mensagemExclusao", () => {
  it("sem filhas nao afirma 'e 0 subtarefas'", () => {
    expect(mensagemExclusao("Landing", 0)).toBe('"Landing" excluída.');
    expect(mensagemExclusao("Landing", 0)).not.toContain("0");
  });

  it("negativo cai no mesmo caminho do zero -- nunca vira '-1 subtarefas'", () => {
    expect(mensagemExclusao("Landing", -3)).toBe('"Landing" excluída.');
  });

  it("uma filha usa SINGULAR", () => {
    expect(mensagemExclusao("Landing", 1)).toBe(
      '"Landing" e 1 subtarefa excluídas.'
    );
  });

  it("varias filhas usam plural com o numero", () => {
    expect(mensagemExclusao("Landing", 6)).toBe(
      '"Landing" e 6 subtarefas excluídas.'
    );
  });

  it("o titulo entra literal, sem truncar -- e a confirmacao do que sumiu", () => {
    const longo = "Campanha ".repeat(12).trim();
    expect(mensagemExclusao(longo, 2)).toContain(longo);
  });
});
