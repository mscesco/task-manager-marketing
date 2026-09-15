import { describe, expect, it } from "vitest";
import { destinoDaNotificacao, textoDaNotificacao } from "@/lib/notificacoes";

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

describe("textoDaNotificacao", () => {
  const payload = { actor_name: "Ana", task_title: "Banner home" };

  it("Spec 050: reacao diz quem, com qual emoji e em qual tarefa", () => {
    expect(
      textoDaNotificacao({
        type: "TASK_COMMENT_REACTED",
        payload: { ...payload, emoji: "👍" },
      }),
    ).toBe('Ana reagiu com 👍 ao seu comentário em "Banner home"');
  });

  it("reacao sem emoji no payload nao mostra 'undefined'", () => {
    const texto = textoDaNotificacao({
      type: "TASK_COMMENT_REACTED",
      payload,
    });
    expect(texto).toBe('Ana reagiu ao seu comentário em "Banner home"');
    expect(texto).not.toContain("undefined");
  });

  // ⚠️ O texto morava no componente, sem teste. Estes tres fixam que a mudanca
  // de casa nao alterou nenhuma frase que ja existia.
  it("os tipos que ja existiam continuam com a mesma frase", () => {
    expect(textoDaNotificacao({ type: "TASK_ASSIGNED", payload })).toBe(
      'Ana designou você em "Banner home"',
    );
    expect(textoDaNotificacao({ type: "TASK_COMMENTED", payload })).toBe(
      'Ana comentou em "Banner home"',
    );
    expect(textoDaNotificacao({ type: "TASK_MENTIONED", payload })).toBe(
      'Ana mencionou você em "Banner home"',
    );
  });

  it("sem payload, cai nos rotulos genericos", () => {
    expect(textoDaNotificacao({ type: "TASK_COMMENTED", payload: null })).toBe(
      'Alguém comentou em "uma tarefa"',
    );
  });
});
