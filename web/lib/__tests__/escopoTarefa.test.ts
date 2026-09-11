import { describe, expect, it } from "vitest";

import { newTaskTeam, timeDaTarefaNova } from "@/lib/escopoTarefa";

const RAIZ = "raiz";
const SUB_A = "sub-a";

// ⚠️ Os testes de `foraDoEscopo` sairam na Spec 034 (03/08) junto com a funcao.
// Deixar teste orfao verde de codigo que ninguem chama e pior que nao ter
// teste: parece cobertura. A regra que eles cobriam -- quem alcanca a tarefa --
// agora e provada contra Postgres em
// `backend/tests/integration/test_members_reaches_task_db.py`, onde ela
// enxerga PAPEL, coisa que este modulo nunca conseguiu.
//
// A queda de 301 para 289 testes e esperada e proposital.

describe("timeDaTarefaNova", () => {
  it("quadro de subtime -> a tarefa nasce INTERNA daquele subtime", () => {
    expect(timeDaTarefaNova(SUB_A, RAIZ)).toBe(SUB_A);
  });

  it("quadro geral (sem team explicito) -> pina na raiz", () => {
    expect(timeDaTarefaNova(null, RAIZ)).toBe(RAIZ);
    expect(timeDaTarefaNova(undefined, RAIZ)).toBe(RAIZ);
  });

  it("raiz ainda nao carregou -> null", () => {
    // O chamador (TaskModal) trata null como "nao sei qual time perguntar" e
    // NAO chama `listMembersDoTime`, deixando a lista sem filtro. Errar
    // oferecendo demais devolve o comportamento anterior, com o 422 do
    // backend ainda de pe; errar escondendo demais tira gente do trabalho.
    expect(timeDaTarefaNova(null, null)).toBe(null);
    expect(timeDaTarefaNova(undefined, null)).toBe(null);
  });

  it("e um CONTRATO com o pin do createTask", () => {
    // Existe como funcao nomeada -- e nao como `a ?? b` solto no componente --
    // porque se o pin do `createTask` mudar, o seletor passa a perguntar pelo
    // time errado e este teste e o unico lugar que grita.
    expect(timeDaTarefaNova(SUB_A, RAIZ)).not.toBe(RAIZ);
  });
});

describe("newTaskTeam", () => {
  const QUADRO = "quadro-avulso";
  const TIME_DO_QUADRO = "time-do-quadro";

  it("quadro geral da RAIZ -> tem time, e NAO e interna", () => {
    // ⚠️ O DEFEITO DE 11/09, reportado na tela com captura. Antes o quadro
    // devolvia `null` aqui, o modal caia no `getRootTeamId()` -- que LEVANTA
    // com mais de uma raiz -- e o seletor de responsavel oferecia a
    // organizacao inteira, gente de outro time raiz incluida.
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
    // O `quadro` vem da rede. Enquanto ele nao chega, a tarefa pina na raiz --
    // que e o comportamento de sempre -- e o seletor de projeto aparece. Marcar
    // `internal` aqui esconderia o seletor por um instante e o traria de volta.
    expect(
      newTaskTeam({ boardId: QUADRO, boardTeamId: null, subteamId: null, rootId: RAIZ }),
    ).toEqual({ teamId: RAIZ, internal: false });
  });

  it("raiz desconhecida no quadro geral -> null, sem filtro (comportamento antigo)", () => {
    // Caminho legado `/quadro` sem time na URL. Errar oferecendo demais devolve
    // o comportamento anterior, com o 422 do backend de pe; errar escondendo
    // demais tira gente do trabalho.
    expect(
      newTaskTeam({ boardId: null, boardTeamId: null, subteamId: null, rootId: null }),
    ).toEqual({ teamId: null, internal: false });
  });

  it("a raiz do `??` NAO torna a tarefa interna", () => {
    // ⚠️ Se `internal` passar a ler `teamId` em vez de `doQuadro`, o quadro
    // geral da raiz volta a esconder o seletor de projeto. Este e o teste que
    // grita.
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
