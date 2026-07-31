import { describe, expect, it } from "vitest";

import { foraDoEscopo, timeDaTarefaNova } from "@/lib/escopoTarefa";

const RAIZ = "raiz";
const SUB_A = "sub-a";
const SUB_B = "sub-b";

// ana e do subtime A, bruno do B, carla so da raiz (subtime null).
const membros = new Map<string, string | null>([
  ["ana", SUB_A],
  ["bruno", SUB_B],
  ["carla", null],
]);

describe("foraDoEscopo", () => {
  it("tarefa da RAIZ nao esconde ninguem", () => {
    // Designar alguem de outra area numa tarefa geral e permitido pelo
    // backend de proposito -- todo mundo enxerga a raiz.
    expect(foraDoEscopo(membros, RAIZ, RAIZ).size).toBe(0);
  });

  it("tarefa INTERNA de subtime esconde quem nao e do subtime", () => {
    const fora = foraDoEscopo(membros, SUB_A, RAIZ);
    expect(fora.has("ana")).toBe(false); // e do subtime A
    expect(fora.has("bruno")).toBe(true); // outro subtime
    expect(fora.has("carla")).toBe(true); // so raiz
  });

  it("subtime B esconde quem e do A", () => {
    const fora = foraDoEscopo(membros, SUB_B, RAIZ);
    expect([...fora].sort()).toEqual(["ana", "carla"]);
  });

  it("sem o id da raiz -> nao esconde ninguem", () => {
    // `getRootTeamId` ainda nao respondeu. Sem saber qual e a raiz nao da
    // pra distinguir tarefa geral de tarefa interna; esconder aqui tiraria
    // gente do seletor por meio segundo, piscando.
    expect(foraDoEscopo(membros, SUB_A, null).size).toBe(0);
  });

  it("tarefa sem time resolvido -> nao esconde ninguem", () => {
    expect(foraDoEscopo(membros, null, RAIZ).size).toBe(0);
    expect(foraDoEscopo(membros, undefined, RAIZ).size).toBe(0);
  });

  it("mapa vazio devolve conjunto vazio, nunca quebra", () => {
    expect(foraDoEscopo(new Map(), SUB_A, RAIZ).size).toBe(0);
  });

  it("nao devolve o mesmo conjunto entre chamadas (sem estado compartilhado)", () => {
    const a = foraDoEscopo(membros, SUB_A, RAIZ);
    const b = foraDoEscopo(membros, SUB_B, RAIZ);
    expect(a).not.toBe(b);
  });
});

describe("timeDaTarefaNova", () => {
  it("quadro de subtime -> a tarefa nasce INTERNA daquele subtime", () => {
    expect(timeDaTarefaNova(SUB_A, RAIZ)).toBe(SUB_A);
  });

  it("quadro geral (sem team explicito) -> pina na raiz", () => {
    expect(timeDaTarefaNova(null, RAIZ)).toBe(RAIZ);
    expect(timeDaTarefaNova(undefined, RAIZ)).toBe(RAIZ);
  });

  it("raiz ainda nao carregou -> null, e ai foraDoEscopo nao esconde ninguem", () => {
    expect(timeDaTarefaNova(null, null)).toBe(null);
    expect(foraDoEscopo(membros, timeDaTarefaNova(null, null), null).size).toBe(0);
  });

  it("criando no quadro de subtime, so o subtime e oferecido", () => {
    // O caso reportado: o seletor de CRIAR tarefa mostrava o workspace todo.
    const fora = foraDoEscopo(membros, timeDaTarefaNova(SUB_A, RAIZ), RAIZ);
    expect([...fora].sort()).toEqual(["bruno", "carla"]);
  });

  it("criando no quadro geral, ninguem e escondido", () => {
    expect(foraDoEscopo(membros, timeDaTarefaNova(null, RAIZ), RAIZ).size).toBe(0);
  });
});
