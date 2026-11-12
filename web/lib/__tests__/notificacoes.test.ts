import { describe, expect, it } from "vitest";
import { destinoDaNotificacao, textoDaNotificacao } from "@/lib/notificacoes";

describe("destinoDaNotificacao", () => {
  it("leva para a rota canonica da tarefa", () => {
    expect(destinoDaNotificacao({ task_id: "abc-123" })).toBe("/tarefa/abc-123");
  });

  it("NAO leva para /minhas-tarefas quando ha tarefa", () => {
    // /minhas-tarefas so acha a tarefa se o destinatario for responsavel dela,
    // e mencao e comentario alcancam quem nao e.
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

  it("com comentario, aponta para ele -- o detalhe rola e destaca", () => {
    expect(destinoDaNotificacao({ task_id: "t1", comment_id: "c9" })).toBe(
      "/tarefa/t1?comentario=c9",
    );
  });
});

describe("textoDaNotificacao", () => {
  const payload = { actor_name: "Ana", task_title: "Banner home" };

  it("reacao diz quem, com qual emoji e em qual tarefa", () => {
    expect(
      textoDaNotificacao({
        type: "TASK_COMMENT_REACTED",
        payload: { ...payload, emoji: "👍" },
      }),
    ).toBe('Ana reagiu com 👍 ao seu comentário em "Banner home"');
  });

  it("resposta diz quem respondeu e em qual tarefa", () => {
    expect(textoDaNotificacao({ type: "TASK_COMMENT_REPLIED", payload })).toBe(
      'Ana respondeu ao seu comentário em "Banner home"',
    );
  });

  it("reacao sem emoji no payload nao mostra 'undefined'", () => {
    const texto = textoDaNotificacao({
      type: "TASK_COMMENT_REACTED",
      payload,
    });
    expect(texto).toBe('Ana reagiu ao seu comentário em "Banner home"');
    expect(texto).not.toContain("undefined");
  });

  it("designar, comentar e mencionar", () => {
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

  it("sem payload, cai nos rotulos genericos -- e 'uma tarefa' vai SEM aspas", () => {
    // Sem titulo e comum: o servidor o tira quando a tarefa foi excluida ou
    // saiu do alcance. Com aspas, "uma tarefa" pareceria o nome.
    expect(textoDaNotificacao({ type: "TASK_COMMENTED", payload: null })).toBe(
      "Alguém comentou em uma tarefa",
    );
  });

  it("tarefa inacessivel nao tem destino", () => {
    expect(destinoDaNotificacao({ task_id: "t1", task_access: "gone" })).toBeNull();
    expect(destinoDaNotificacao({ task_id: "t1", task_access: "ok" })).toBe("/tarefa/t1");
  });
});

describe("textoDaNotificacao: prazo, acesso e mudancas na tarefa", () => {
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

  it("colocar e tirar como seguidor dizem quem fez", () => {
    const p = { actor_name: "Ana", task_title: "Banner" };
    expect(textoDaNotificacao({ type: "TASK_WATCH_ADDED", payload: p })).toBe(
      'Ana colocou você para seguir "Banner"',
    );
    expect(textoDaNotificacao({ type: "TASK_WATCH_REMOVED", payload: p })).toBe(
      'Ana tirou você de "Banner"',
    );
  });

  it("coluna diz de onde e para onde", () => {
    expect(
      textoDaNotificacao({
        type: "TASK_COLUMN_CHANGED",
        payload: { actor_name: "Ana", task_title: "Banner", from_column: "Backlog", to_column: "Concluído" },
      }),
    ).toBe('Ana moveu "Banner" de Backlog para Concluído');
  });

  it("prazo com hora, sem hora e tirado", () => {
    const base = { actor_name: "Ana", task_title: "Banner" };
    expect(
      textoDaNotificacao({
        type: "TASK_DUE_CHANGED",
        payload: { ...base, to_due: { date: "2026-09-20", time: "18:00" } },
      }),
    ).toBe('Ana mudou o prazo de "Banner" para 20/09 18:00');
    expect(
      textoDaNotificacao({
        type: "TASK_DUE_CHANGED",
        payload: { ...base, to_due: { date: "2026-09-20", time: null } },
      }),
    ).toBe('Ana mudou o prazo de "Banner" para 20/09');
    expect(
      textoDaNotificacao({ type: "TASK_DUE_CHANGED", payload: { ...base, to_due: null } }),
    ).toBe('Ana tirou o prazo de "Banner"');
  });

  it("descricao, arquivar, desarquivar e excluir", () => {
    const p = { actor_name: "Ana", task_title: "Banner" };
    expect(textoDaNotificacao({ type: "TASK_DESCRIPTION_CHANGED", payload: p })).toBe(
      'Ana editou a descrição de "Banner"',
    );
    expect(textoDaNotificacao({ type: "TASK_ARCHIVED", payload: p })).toBe('Ana arquivou "Banner"');
    expect(textoDaNotificacao({ type: "TASK_UNARCHIVED", payload: p })).toBe('Ana desarquivou "Banner"');
    expect(textoDaNotificacao({ type: "TASK_DELETED", payload: p })).toBe('Ana excluiu "Banner"');
  });
});
