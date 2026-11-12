// O aviso de exclusão de tarefa. O caminho destrutivo (TaskDetail ->
// deleteTask) é fiação de componente e não é coberto aqui.
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
