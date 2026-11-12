/** O plano de soltar um card: lista otimista, reversão e recusa. */
import { describe, expect, it } from "vitest";

import { applyDrop, planDrop, revertDrop } from "@/lib/taskDrag";
import type { Coluna, ColumnSemantic } from "@/lib/coluna";

function coluna(id: string, semantic: ColumnSemantic): Coluna {
  return {
    id,
    name: id,
    color: "var(--status-backlog-dot)",
    position: 0,
    semantic,
    notify_deadline: false,
    is_default_target: false,
    is_status_bridge: false,
  };
}

const COLUNAS = [
  coluna("aberta", "OPEN"),
  coluna("fazendo", "IN_PROGRESS"),
  coluna("feita", "DONE"),
  coluna("entregue", "DONE"),
  coluna("cancelada", "CANCELLED"),
];
const porId = new Map(COLUNAS.map((c) => [c.id, c]));
const columnOf = (id: string) => porId.get(id);

type T = {
  id: string;
  path: string;
  column_id: string;
  status: string;
  is_archived: boolean;
  subtask_done?: number;
  subtask_total?: number;
};

function t(id: string, path: string, column_id: string, over: Partial<T> = {}): T {
  return { id, path, column_id, status: "BACKLOG", is_archived: false, ...over };
}

// Mãe com 4 subtarefas carregadas: só a aberta e a em andamento cascateiam.
const MAE = t("mae", "mae", "fazendo", { subtask_done: 1, subtask_total: 4 });
const LOTE: T[] = [
  MAE,
  t("aberta", "mae.aberta", "aberta"),
  t("neta", "mae.aberta.neta", "fazendo", { status: "IN_PROGRESS" }),
  t("arquivada", "mae.arquivada", "aberta", { is_archived: true }),
  t("feita", "mae.feita", "feita", { status: "COMPLETED" }),
  t("cancelada", "mae.cancelada", "cancelada", { status: "CANCELLED" }),
  t("prima", "maeX.prima", "aberta"),
];

const plano = (to: string | null, over = {}) =>
  planDrop(LOTE, "mae", to, { columns: COLUNAS, columnOf, countSubtasks: true, ...over });

describe("planDrop", () => {
  it("soltar em DONE cascateia só as subtarefas não terminais e não arquivadas", () => {
    const p = plano("feita")!;
    expect([...p.cascaded.keys()]).toEqual(["aberta", "neta"]);
    expect(p.cascaded.get("neta")).toEqual({ column: "fazendo", status: "IN_PROGRESS" });
  });

  it("fora de DONE não há cascata", () => {
    expect(plano("aberta")!.cascaded.size).toBe(0);
  });

  it("recusa coluna que não é desta tela (outro quadro)", () => {
    expect(plano("coluna-de-outro-quadro")).toBeNull();
  });

  it("sem destino, mesma coluna ou recusado pelo chamador: nada a fazer", () => {
    expect(plano(null)).toBeNull();
    expect(plano("fazendo")).toBeNull();
    expect(plano("feita", { canMove: () => false })).toBeNull();
  });

  it("confete só quando vira concluída", () => {
    expect(plano("feita")!.celebrate).toBe(true);
    expect(plano("aberta")!.celebrate).toBe(false);
    const deCanceladaParaFeita = planDrop([t("mae", "mae", "cancelada")], "mae", "feita", {
      columns: COLUNAS,
      columnOf,
    });
    expect(deCanceladaParaFeita!.celebrate).toBe(true);
    const deDoneParaDone = planDrop([t("mae", "mae", "feita")], "mae", "entregue", {
      columns: COLUNAS,
      columnOf,
    });
    expect(deDoneParaDone!.celebrate).toBe(false);
  });
});

describe("applyDrop", () => {
  it("move a mãe, conclui a cascata e enche o contador da mãe", () => {
    const depois = applyDrop(LOTE, plano("feita")!);
    const byId = new Map(depois.map((x) => [x.id, x]));
    expect(byId.get("mae")).toMatchObject({ column_id: "feita", subtask_done: 4 });
    expect(byId.get("aberta")).toMatchObject({ column_id: "feita", status: "COMPLETED" });
    expect(byId.get("neta")).toMatchObject({ column_id: "feita", status: "COMPLETED" });
    // Fora da cascata, intocadas.
    for (const id of ["arquivada", "feita", "cancelada", "prima"])
      expect(byId.get(id)).toBe(LOTE.find((x) => x.id === id));
  });

  it("fora de DONE o contador da mãe fica", () => {
    const mae = applyDrop(LOTE, plano("aberta")!)[0];
    expect(mae).toMatchObject({ column_id: "aberta", subtask_done: 1 });
  });

  it("sem countSubtasks, o contador não é tocado", () => {
    const p = planDrop(LOTE, "mae", "feita", { columns: COLUNAS, columnOf })!;
    expect(applyDrop(LOTE, p)[0]).toMatchObject({ column_id: "feita", subtask_done: 1 });
  });
});

describe("revertDrop", () => {
  it("desfaz o otimista inteiro, contador da mãe junto", () => {
    const p = plano("feita")!;
    expect(revertDrop(applyDrop(LOTE, p), p)).toEqual(LOTE);
  });
});
