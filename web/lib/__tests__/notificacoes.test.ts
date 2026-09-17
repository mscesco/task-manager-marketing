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

// Spec 053, fatia A: os tres tipos que o backend emitia e o sino nao sabia
// dizer -- caiam todos em `Atualização em "..."`.
//
// SABOTAGEM: apagar o ramo `TASK_OVERDUE` de `textoDaNotificacao`. Deve cair
// "atrasada tem texto proprio".
describe("textoDaNotificacao -- prazo e acesso (Spec 053, A)", () => {
  const HOJE = { data: "2026-09-17", hora: "09:00" };

  it("vence em breve: com a data, no formato DD/MM", () => {
    expect(
      textoDaNotificacao(
        { type: "TASK_DUE_SOON", payload: { task_title: "Banner", due_date: "2026-09-19" } },
        HOJE,
      ),
    ).toBe('"Banner" vence em 19/09');
  });

  it("vence hoje, quando o prazo e o dia de hoje NO FUSO DO WORKSPACE", () => {
    expect(
      textoDaNotificacao(
        { type: "TASK_DUE_SOON", payload: { task_title: "Banner", due_date: "2026-09-17" } },
        HOJE,
      ),
    ).toBe('"Banner" vence hoje');
  });

  it("vence em breve sem data no payload nao mostra 'undefined'", () => {
    const texto = textoDaNotificacao(
      { type: "TASK_DUE_SOON", payload: { task_title: "Banner" } },
      HOJE,
    );
    expect(texto).toBe('"Banner" vence em breve');
  });

  it("atrasada tem texto proprio", () => {
    expect(
      textoDaNotificacao({ type: "TASK_OVERDUE", payload: { task_title: "Banner" } }),
    ).toBe('"Banner" está atrasada');
  });

  it("perda de acesso fala em ACESSO, no singular e no plural", () => {
    expect(
      textoDaNotificacao({
        type: "ACCESS_LOST",
        payload: { actor_name: "Ana", quantidade: 3 },
      }),
    ).toBe("Ana mudou seu time: você deixou de ter acesso a 3 tarefas");
    expect(
      textoDaNotificacao({
        type: "ACCESS_LOST",
        payload: { actor_name: "Ana", quantidade: 1 },
      }),
    ).toBe("Ana mudou seu time: você deixou de ter acesso a 1 tarefa");
  });

  it("Spec 053 (B): colocar e tirar como seguidor dizem quem fez", () => {
    const p = { actor_name: "Ana", task_title: "Banner" };
    expect(textoDaNotificacao({ type: "TASK_WATCH_ADDED", payload: p })).toBe(
      'Ana colocou você para seguir "Banner"',
    );
    expect(textoDaNotificacao({ type: "TASK_WATCH_REMOVED", payload: p })).toBe(
      'Ana tirou você de "Banner"',
    );
  });

  it("nenhum dos tres cai mais no texto generico", () => {
    for (const type of ["TASK_DUE_SOON", "TASK_OVERDUE", "ACCESS_LOST"] as const) {
      expect(
        textoDaNotificacao({ type, payload: { task_title: "X", quantidade: 2 } }, HOJE),
      ).not.toContain("Atualização em");
    }
  });
});
