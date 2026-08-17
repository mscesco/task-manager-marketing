// Checklist de subtarefas (Spec 031, C11).
//
// O teste que importa e o ultimo bloco: as DUAS contagens nao podem ser
// confundidas. Trocar uma pela outra apaga um aviso de exclusao em silencio.
import { describe, expect, it } from "vitest";

import { ativas, checklist, paraChecklist, progresso } from "@/lib/subtarefas";
import type { Coluna } from "@/lib/coluna";

/**
 * ⚠️ A FIXTURE FALA DE COLUNA, e nao mais de status (fatia 4c-2). O nome do
 * parametro mudou de proposito: `f("col-done")` continuaria compilando se
 * fosse `column_id: string`, e um teste que passa o status como se fosse id de
 * coluna passa verde afirmando o contrario do que diz.
 */
const f = (coluna: string, is_archived = false) => ({
  column_id: coluna,
  is_archived,
});

/**
 * O mapa de colunas dos testes. So o que eles usam -- mesma decisao (e mesmo
 * motivo) do `minhasTarefas.test.tsx` e do `Board.test.tsx`.
 */
const COLUNAS = new Map<string, Coluna>([
  [
    "col-backlog",
    {
      id: "col-backlog",
      name: "Backlog",
      color: "var(--status-backlog-dot)",
      position: 0,
      semantic: "OPEN",
      notify_deadline: true,
      is_default_target: true,
      is_status_bridge: false,
    },
  ],
  [
    "col-done",
    {
      id: "col-done",
      name: "Concluído",
      color: "var(--status-done-dot)",
      position: 5,
      semantic: "DONE",
      notify_deadline: true,
      is_default_target: true,
      is_status_bridge: false,
    },
  ],
  [
    "col-cancel",
    {
      id: "col-cancel",
      name: "Cancelado",
      color: "var(--status-cancel-dot)",
      position: 6,
      semantic: "CANCELLED",
      notify_deadline: true,
      is_default_target: true,
      is_status_bridge: false,
    },
  ],
]);

describe("ativas", () => {
  it("tira as arquivadas", () => {
    expect(ativas([f("col-backlog"), f("col-backlog", true)])).toHaveLength(1);
  });
  it("lista vazia continua vazia", () => {
    expect(ativas([])).toEqual([]);
  });
  it("todas arquivadas -> nenhuma ativa", () => {
    expect(ativas([f("col-done", true), f("col-backlog", true)])).toEqual([]);
  });
});

describe("progresso", () => {
  it("conta so as concluidas ATIVAS", () => {
    const r = progresso([f("col-done"), f("col-backlog"), f("col-done", true)], COLUNAS);
    expect(r).toEqual({ concluidas: 1, total: 2, pct: 50 });
  });
  it("sem filha ativa -> pct 0, NUNCA NaN", () => {
    const r = progresso([f("col-done", true)], COLUNAS);
    expect(r.total).toBe(0);
    expect(r.pct).toBe(0);
    expect(Number.isNaN(r.pct)).toBe(false);
  });
  it("lista vazia -> pct 0", () => {
    expect(progresso([], COLUNAS).pct).toBe(0);
  });
  it("tudo concluido -> 100", () => {
    expect(progresso([f("col-done"), f("col-done")], COLUNAS).pct).toBe(100);
  });
  it("arredonda para inteiro -- 1 de 3 nao vira 33.333", () => {
    expect(progresso([f("col-done"), f("col-backlog"), f("col-backlog")], COLUNAS).pct).toBe(33);
  });
});

describe("paraChecklist", () => {
  const filhos = [f("col-backlog"), f("col-done", true)];

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
    expect(progresso(filhos, COLUNAS).total).toBe(1);
    expect(progresso(paraChecklist(filhos, true), COLUNAS).total).toBe(1);
  });
});

describe("checklist", () => {
  // Regressao do rotulo "(x/y)" e da barra: o numerador vinha de `progresso`
  // (so vivas) e o denominador de `paraChecklist(...).length` (com arquivada,
  // quando a caixa esta marcada). Os dois agora saem da MESMA chamada.
  it("numerador e denominador saem da mesma conta -- nunca divergem", () => {
    const filhos = [f("col-done"), f("col-backlog"), f("col-done", true)];
    const r = checklist(filhos, true, COLUNAS);
    expect(r.linhas).toHaveLength(3); // desenha as tres
    expect(r.concluidas).toBe(1); // conta 1 de 2 vivas
    expect(r.total).toBe(2);
    expect(r.pct).toBe(50); // a barra bate com o rotulo
  });

  it("marcar 'mostrar arquivadas' muda as LINHAS, nao a conta", () => {
    const filhos = [f("col-done"), f("col-backlog"), f("col-done", true)];
    const escondendo = checklist(filhos, false, COLUNAS);
    const mostrando = checklist(filhos, true, COLUNAS);
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
    const r = checklist([f("col-done", true), f("col-backlog", true)], true, COLUNAS);
    expect(r.linhas).toHaveLength(2);
    expect(r.total).toBe(0);
    expect(r.concluidas).toBe(0);
    expect(r.pct).toBe(0);
  });

  it("sem arquivada nenhuma, linhas e total andam juntos", () => {
    const r = checklist([f("col-done"), f("col-backlog")], false, COLUNAS);
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
    const filhos = [f("col-done", true), f("col-backlog", true)];
    expect(ativas(filhos)).toHaveLength(0);
    expect(filhos.length).toBe(2);
  });
});

// =====================================================================
// Fatia 4c-2 -- a conta decide pela COLUNA.
//
// ⚠️ Estes tres nao existiam: a regra antiga, por `status`, nao tinha como
// distinguir os casos abaixo. Sao eles que separam "conta coluna" de
// "conta status".
// =====================================================================
describe("progresso -- pela coluna (fatia 4c-2)", () => {
  it("conta pela coluna mesmo com o status dizendo outra coisa", () => {
    // ⚠️ O PAR TORTO, que e o estado real da tela logo depois de arrastar um
    // pai para conclusao: a atualizacao otimista move a COLUNA, e o `status`
    // so chega na resposta. Contando por status daria 0/1.
    // (`status` nem entra no objeto: a assinatura passou a pedir SO
    // `column_id` e `is_archived`, entao a regra nao TEM como olhar status --
    // e o `tsc` recusa o campo a mais, o que e a prova mais forte possivel.)
    const r = progresso([f("col-done")], COLUNAS);
    expect(r).toEqual({ concluidas: 1, total: 1, pct: 100 });
  });

  it("cancelada NAO conta como concluida, mas conta no total", () => {
    // ⚠️ `DONE` e nao `terminal()`. Se cancelada contasse como entregue, uma
    // tarefa com metade das filhas canceladas apareceria 100% pronta.
    const r = progresso([f("col-cancel"), f("col-done")], COLUNAS);
    expect(r).toEqual({ concluidas: 1, total: 2, pct: 50 });
  });

  it("coluna DESCONHECIDA conta como trabalho vivo, nao some da conta", () => {
    // ⚠️ O contrario -- sumir do denominador -- inflaria a porcentagem em
    // silencio: 1 de 1 em vez de 1 de 2. Perda silenciosa de novo.
    const r = progresso([f("col-de-outro-quadro"), f("col-done")], COLUNAS);
    expect(r).toEqual({ concluidas: 1, total: 2, pct: 50 });
  });
});
