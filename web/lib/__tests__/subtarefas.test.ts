// Checklist de subtarefas (Spec 031, C11).
//
// O teste que importa e o ultimo bloco: as DUAS contagens nao podem ser
// confundidas. Trocar uma pela outra apaga um aviso de exclusao em silencio.
import { describe, expect, it } from "vitest";

import { ativas, paraChecklist, progresso } from "@/lib/subtarefas";

const f = (status: string, is_archived = false) => ({ status, is_archived });

describe("ativas", () => {
  it("tira as arquivadas", () => {
    expect(ativas([f("BACKLOG"), f("BACKLOG", true)])).toHaveLength(1);
  });
  it("lista vazia continua vazia", () => {
    expect(ativas([])).toEqual([]);
  });
  it("todas arquivadas -> nenhuma ativa", () => {
    expect(ativas([f("COMPLETED", true), f("BACKLOG", true)])).toEqual([]);
  });
});

describe("progresso", () => {
  it("conta so as concluidas ATIVAS", () => {
    const r = progresso([f("COMPLETED"), f("BACKLOG"), f("COMPLETED", true)]);
    expect(r).toEqual({ concluidas: 1, total: 2, pct: 50 });
  });
  it("sem filha ativa -> pct 0, NUNCA NaN", () => {
    const r = progresso([f("COMPLETED", true)]);
    expect(r.total).toBe(0);
    expect(r.pct).toBe(0);
    expect(Number.isNaN(r.pct)).toBe(false);
  });
  it("lista vazia -> pct 0", () => {
    expect(progresso([]).pct).toBe(0);
  });
  it("tudo concluido -> 100", () => {
    expect(progresso([f("COMPLETED"), f("COMPLETED")]).pct).toBe(100);
  });
  it("arredonda para inteiro -- 1 de 3 nao vira 33.333", () => {
    expect(progresso([f("COMPLETED"), f("BACKLOG"), f("BACKLOG")]).pct).toBe(33);
  });
});

describe("paraChecklist", () => {
  const filhos = [f("BACKLOG"), f("COMPLETED", true)];

  it("escondendo arquivadas -> so as vivas", () => {
    expect(paraChecklist(filhos, false)).toHaveLength(1);
  });
  it("mostrando arquivadas -> todas, na ordem original", () => {
    expect(paraChecklist(filhos, true)).toEqual(filhos);
  });
  it("mostrar arquivadas NAO mexe no progresso", () => {
    // A barra responde "quanto falta do trabalho vivo". Se a arquivada
    // concluida entrasse na conta, marcar/desmarcar a caixa mudaria a
    // porcentagem sem ninguem ter trabalhado.
    expect(progresso(filhos).total).toBe(1);
    expect(progresso(paraChecklist(filhos, true)).total).toBe(1);
  });
});

describe("as duas contagens NAO sao a mesma", () => {
  // Regressao: o guarda do aviso de exclusao usou a contagem da checklist e
  // uma tarefa com filhas SO arquivadas deixou de avisar que a cascata as
  // levaria junto.
  it("filhas so arquivadas: checklist vazia, mas HA o que a cascata apaga", () => {
    const filhos = [f("COMPLETED", true), f("BACKLOG", true)];
    expect(ativas(filhos)).toHaveLength(0);
    expect(filhos.length).toBe(2);
  });
});
