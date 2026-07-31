// Checklist de subtarefas (Spec 031, C11).
//
// O teste que importa e o ultimo bloco: as DUAS contagens nao podem ser
// confundidas. Trocar uma pela outra apaga um aviso de exclusao em silencio.
import { describe, expect, it } from "vitest";

import { ativas, checklist, paraChecklist, progresso } from "@/lib/subtarefas";

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

describe("checklist", () => {
  // Regressao do rotulo "(x/y)" e da barra: o numerador vinha de `progresso`
  // (so vivas) e o denominador de `paraChecklist(...).length` (com arquivada,
  // quando a caixa esta marcada). Os dois agora saem da MESMA chamada.
  it("numerador e denominador saem da mesma conta -- nunca divergem", () => {
    const filhos = [f("COMPLETED"), f("BACKLOG"), f("COMPLETED", true)];
    const r = checklist(filhos, true);
    expect(r.linhas).toHaveLength(3); // desenha as tres
    expect(r.concluidas).toBe(1); // conta 1 de 2 vivas
    expect(r.total).toBe(2);
    expect(r.pct).toBe(50); // a barra bate com o rotulo
  });

  it("marcar 'mostrar arquivadas' muda as LINHAS, nao a conta", () => {
    const filhos = [f("COMPLETED"), f("BACKLOG"), f("COMPLETED", true)];
    const escondendo = checklist(filhos, false);
    const mostrando = checklist(filhos, true);
    expect(escondendo.linhas).toHaveLength(2);
    expect(mostrando.linhas).toHaveLength(3);
    expect(mostrando.concluidas).toBe(escondendo.concluidas);
    expect(mostrando.total).toBe(escondendo.total);
    expect(mostrando.pct).toBe(escondendo.pct);
  });

  it("filhas SO arquivadas: ha linha pra desenhar, mas nao ha o que contar", () => {
    // O caso permanente de `/arquivadas`. Antes: "(0/2)" com barra vazia
    // embaixo de duas caixas marcadas. Agora `total: 0` -- a tela sabe que
    // nao deve desenhar contador nem barra.
    const r = checklist([f("COMPLETED", true), f("BACKLOG", true)], true);
    expect(r.linhas).toHaveLength(2);
    expect(r.total).toBe(0);
    expect(r.concluidas).toBe(0);
    expect(r.pct).toBe(0);
  });

  it("sem arquivada nenhuma, linhas e total andam juntos", () => {
    const r = checklist([f("COMPLETED"), f("BACKLOG")], false);
    expect(r.linhas).toHaveLength(2);
    expect(r.total).toBe(2);
    expect(r.pct).toBe(50);
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
