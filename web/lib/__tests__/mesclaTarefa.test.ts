/**
 * A guarda dos campos que a mutacao NAO devolve (ADR 0025 + Spec 042).
 *
 * ⚠️ Cada caso aqui corresponde a uma encarnacao REAL do mesmo defeito. Ver o
 * cabecalho de `lib/mesclaTarefa.ts` para a lista das quatro.
 */
import { describe, expect, it } from "vitest";

import { mesclaTarefa } from "@/lib/mesclaTarefa";
import type { Task } from "@/lib/api";

function tarefa(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    project_id: null,
    parent_task_id: null,
    team_id: null,
    title: "Tarefa",
    description: "",
    status: "BACKLOG",
    priority: "MEDIUM",
    position: 0,
    depth: 0,
    path: "t1",
    board_id: "b1",
    column_id: "c1",
    start_date: null,
    due_date: null,
    due_time: null,
    completed_at: null,
    is_archived: false,
    created_by: "u0",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...over,
  } as Task;
}

/** O que o `PATCH` devolve de verdade: `TaskResponse`, sem os quatro campos. */
function comoOPatchResponde(base: Task, over: Partial<Task> = {}): Task {
  const {
    assignee_ids: _a,
    subtask_total: _b,
    subtask_done: _c,
    subtree_assignee_ids: _d,
    ...semOsQuatro
  } = { ...base, ...over };
  return semOsQuatro as Task;
}

describe("mesclaTarefa", () => {
  it("sem anterior, devolve a resposta como veio", () => {
    const r = tarefa({ assignee_ids: ["u1"] });
    expect(mesclaTarefa(r, undefined)).toEqual(r);
  });

  it("⚠️ preserva `assignee_ids` que o PATCH nao devolve (ADR 0025)", () => {
    const anterior = tarefa({ assignee_ids: ["u1", "u2"] });
    const resposta = comoOPatchResponde(anterior, { title: "Novo título" });
    const m = mesclaTarefa(resposta, anterior);
    expect(m.assignee_ids).toEqual(["u1", "u2"]);
    expect(m.title).toBe("Novo título");
  });

  it("⚠️ preserva os tres agregados da Spec 042", () => {
    const anterior = tarefa({
      subtask_total: 5,
      subtask_done: 2,
      subtree_assignee_ids: ["u1", "u9"],
    });
    const resposta = comoOPatchResponde(anterior, { title: "Editado" });
    const m = mesclaTarefa(resposta, anterior);
    expect(m.subtask_total).toBe(5);
    expect(m.subtask_done).toBe(2);
    expect(m.subtree_assignee_ids).toEqual(["u1", "u9"]);
  });

  it("a resposta GANHA quando traz o campo", () => {
    const anterior = tarefa({ assignee_ids: ["u1"], subtask_done: 2 });
    const resposta = tarefa({ assignee_ids: ["u3"], subtask_done: 4 });
    const m = mesclaTarefa(resposta, anterior);
    expect(m.assignee_ids).toEqual(["u3"]);
    expect(m.subtask_done).toBe(4);
  });

  it("⚠️ ZERO e LISTA VAZIA sao respostas, e nao ausencia", () => {
    // O motivo de ser `??` e nao `||`. Com `||`, um card que passou a ter zero
    // subtarefas (a ultima foi apagada) herdaria o contador velho para sempre,
    // e alguem sem responsavel voltaria a mostrar o responsavel antigo.
    const anterior = tarefa({
      assignee_ids: ["u1"],
      subtask_total: 5,
      subtask_done: 2,
    });
    const resposta = tarefa({
      assignee_ids: [],
      subtask_total: 0,
      subtask_done: 0,
    });
    const m = mesclaTarefa(resposta, anterior);
    expect(m.assignee_ids).toEqual([]);
    expect(m.subtask_total).toBe(0);
    expect(m.subtask_done).toBe(0);
  });
});
