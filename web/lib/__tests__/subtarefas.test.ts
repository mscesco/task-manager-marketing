// Checklist de subtarefas: progresso, linhas e a conta pela coluna.
import { describe, expect, it } from "vitest";

import { ativas, checklist, ordemDaChecklist, paraChecklist, progresso } from "@/lib/subtarefas";
import type { Coluna } from "@/lib/coluna";

/** A fixture recebe id de COLUNA, não status: a conta é pela coluna. */
const f = (coluna: string, is_archived = false) => ({
  column_id: coluna,
  is_archived,
  due_date: null as string | null,
  due_time: null as string | null,
});

/** O mapa de colunas dos testes, só com o que eles usam. */
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
  // O rótulo "(x/y)" e a barra saem da mesma chamada: com arquivadas à
  // mostra, as linhas crescem mas o denominador continua só das vivas.
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
    // O caso de `/arquivadas`: `total: 0` diz à tela para não desenhar
    // contador nem barra.
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

describe("progresso pela semântica da coluna", () => {

  it("cancelada NAO conta como concluida, mas conta no total", () => {
    // `DONE`, e não `terminal()`. Se cancelada contasse como entregue, uma
    // tarefa com metade das filhas canceladas apareceria 100% pronta.
    const r = progresso([f("col-cancel"), f("col-done")], COLUNAS);
    expect(r).toEqual({ concluidas: 1, total: 2, pct: 50 });
  });

  it("coluna DESCONHECIDA conta como trabalho vivo, nao some da conta", () => {
    // Sumir do denominador inflaria a porcentagem: 1 de 1 em vez de 1 de 2.
    const r = progresso([f("col-de-outro-quadro"), f("col-done")], COLUNAS);
    expect(r).toEqual({ concluidas: 1, total: 2, pct: 50 });
  });
});

describe("ordemDaChecklist", () => {
  const COM_CANCELADA = new Map(COLUNAS).set("col-cancel", {
    ...COLUNAS.get("col-done")!,
    id: "col-cancel",
    semantic: "CANCELLED",
  });
  const sub = (id: string, coluna: string, due_date: string | null, due_time: string | null = null) => ({
    id,
    column_id: coluna,
    due_date,
    due_time,
  });
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it("por prazo, sem prazo depois, concluída e cancelada por último", () => {
    const filhos = [
      sub("feita-cedo", "col-done", "2026-01-01"),
      sub("sem-prazo", "col-backlog", null),
      sub("dia-20", "col-backlog", "2026-03-20"),
      sub("cancelada", "col-cancel", "2026-01-02"),
      sub("dia-10", "col-backlog", "2026-03-10"),
    ];
    expect(ids(ordemDaChecklist(filhos, COM_CANCELADA))).toEqual([
      "dia-10",
      "dia-20",
      "sem-prazo",
      "feita-cedo",
      "cancelada",
    ]);
  });

  it("no mesmo dia, com hora vem antes; sem hora fecha o dia", () => {
    const filhos = [
      sub("sem-hora", "col-backlog", "2026-03-10"),
      sub("18h", "col-backlog", "2026-03-10", "18:00:00"),
      sub("9h", "col-backlog", "2026-03-10", "09:00:00"),
    ];
    expect(ids(ordemDaChecklist(filhos, COLUNAS))).toEqual(["9h", "18h", "sem-hora"]);
  });

  it("empate mantém a ordem que veio do servidor", () => {
    const filhos = [sub("b", "col-backlog", null), sub("a", "col-backlog", null)];
    expect(ids(ordemDaChecklist(filhos, COLUNAS))).toEqual(["b", "a"]);
  });

  it("checklist entrega as linhas já nessa ordem", () => {
    const filhos = [
      { ...f("col-done"), due_date: "2026-01-01" },
      { ...f("col-backlog"), due_date: null },
    ];
    expect(checklist(filhos, false, COLUNAS).linhas.map((x) => x.column_id)).toEqual([
      "col-backlog",
      "col-done",
    ]);
  });
});
