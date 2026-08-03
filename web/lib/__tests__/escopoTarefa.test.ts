import { describe, expect, it } from "vitest";

import { timeDaTarefaNova } from "@/lib/escopoTarefa";

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
