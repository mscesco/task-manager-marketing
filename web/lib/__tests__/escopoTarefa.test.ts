import { describe, expect, it } from "vitest";

import { newTaskTeam, timeDaTarefaNova } from "@/lib/escopoTarefa";

const RAIZ = "raiz";
const SUB_A = "sub-a";

describe("timeDaTarefaNova", () => {
  it("quadro de subtime -> a tarefa nasce INTERNA daquele subtime", () => {
    expect(timeDaTarefaNova(SUB_A, RAIZ)).toBe(SUB_A);
  });

  it("quadro geral (sem team explicito) -> pina na raiz", () => {
    expect(timeDaTarefaNova(null, RAIZ)).toBe(RAIZ);
    expect(timeDaTarefaNova(undefined, RAIZ)).toBe(RAIZ);
  });

  it("raiz ainda nao carregou -> null", () => {
    // O TaskModal trata null como "sem filtro": oferecer demais é seguro (o
    // backend recusa com 422), esconder demais tira gente do trabalho.
    expect(timeDaTarefaNova(null, null)).toBe(null);
    expect(timeDaTarefaNova(undefined, null)).toBe(null);
  });
});

describe("newTaskTeam", () => {
  const QUADRO = "quadro-avulso";
  const TIME_DO_QUADRO = "time-do-quadro";

  it("quadro geral da RAIZ -> tem time, e NAO e interna", () => {
    // Com `null` aqui, o modal cairia no `getRootTeamId()`, que levanta com
    // mais de uma raiz, e o seletor ofereceria a organização inteira.
    expect(
      newTaskTeam({ boardId: null, boardTeamId: null, subteamId: null, rootId: RAIZ }),
    ).toEqual({ teamId: RAIZ, internal: false });
  });

  it("quadro de subtime -> interna daquele subtime", () => {
    expect(
      newTaskTeam({ boardId: null, boardTeamId: null, subteamId: SUB_A, rootId: RAIZ }),
    ).toEqual({ teamId: SUB_A, internal: true });
  });

  it("quadro avulso -> o time do quadro, e interna", () => {
    expect(
      newTaskTeam({
        boardId: QUADRO,
        boardTeamId: TIME_DO_QUADRO,
        subteamId: SUB_A,
        rootId: RAIZ,
      }),
    ).toEqual({ teamId: TIME_DO_QUADRO, internal: true });
  });

  it("quadro avulso manda mais que subtime (precedencia de sempre)", () => {
    const r = newTaskTeam({
      boardId: QUADRO,
      boardTeamId: TIME_DO_QUADRO,
      subteamId: SUB_A,
      rootId: RAIZ,
    });
    expect(r.teamId).not.toBe(SUB_A);
  });

  it("quadro avulso cujo time ainda nao chegou -> cai na raiz, e NAO e interna", () => {
    // Marcar `internal` enquanto o quadro carrega esconderia o seletor de
    // projeto por um instante e o traria de volta.
    expect(
      newTaskTeam({ boardId: QUADRO, boardTeamId: null, subteamId: null, rootId: RAIZ }),
    ).toEqual({ teamId: RAIZ, internal: false });
  });

  it("raiz desconhecida no quadro geral -> null, sem filtro", () => {
    // Caminho `/quadro` sem time na URL: sem filtro, como acima.
    expect(
      newTaskTeam({ boardId: null, boardTeamId: null, subteamId: null, rootId: null }),
    ).toEqual({ teamId: null, internal: false });
  });

  it("a raiz do `??` NAO torna a tarefa interna", () => {
    // Se `internal` ler `teamId` em vez do quadro, o quadro geral da raiz
    // esconde o seletor de projeto.
    const r = newTaskTeam({
      boardId: null,
      boardTeamId: null,
      subteamId: null,
      rootId: RAIZ,
    });
    expect(r.teamId).toBe(RAIZ);
    expect(r.internal).toBe(false);
  });
});
