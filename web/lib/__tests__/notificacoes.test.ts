import { describe, expect, it } from "vitest";
import { destinoDaNotificacao } from "@/lib/notificacoes";

describe("destinoDaNotificacao", () => {
  it("leva para a rota canonica da tarefa", () => {
    expect(destinoDaNotificacao({ task_id: "abc-123" })).toBe("/tarefa/abc-123");
  });

  it("NAO leva para /minhas-tarefas quando ha tarefa -- era a causa do bug", () => {
    // A rota antiga so achava a tarefa se o destinatario fosse responsavel
    // dela. Mencao e comentario alcancam quem nao e, e o clique nao abria nada.
    const destino = destinoDaNotificacao({ task_id: "abc-123" });
    expect(destino).not.toContain("minhas-tarefas");
    expect(destino).not.toContain("?task=");
  });

  it("NAO leva para o quadro -- ele nao mostra subtarefa nem arquivada", () => {
    expect(destinoDaNotificacao({ task_id: "abc-123" })).not.toContain("quadro");
  });

  it("sem tarefa associada, cai no painel padrao", () => {
    expect(destinoDaNotificacao({ task_id: null })).toBe("/minhas-tarefas");
  });
});
