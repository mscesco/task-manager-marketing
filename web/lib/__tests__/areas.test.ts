/**
 * Spec 046, fatia 1 -- ÁREA (time raiz) resolvida sem sorteio.
 *
 * ⚠️⚠️ ESTE ARQUIVO É O GUARDIÃO DE UM CASO QUE O BANCO AINDA NÃO DEIXA
 * EXISTIR, e é justamente por isso que ele vem antes.
 *
 * Enquanto o índice parcial `team_unica_raiz_por_workspace` estiver de pé
 * (a fatia 2 é quem o derruba), NENHUM teste de integração e NENHUM uso real
 * consegue montar duas áreas. Ou seja: o `find` errado e a regra certa dão
 * exatamente o mesmo resultado em todo lugar, hoje.
 *
 * ⚠️ É a mesma armadilha que a Spec 045 §3 descreveu para o escopo de
 * permissão, e a saída é a mesma: montar a segunda árvore EM MEMÓRIA, numa
 * função pura, porque é o único lugar onde o banco não manda.
 *
 * Sem este arquivo, a fatia 1 seria só uma troca de código sem prova.
 */

import { describe, it, expect } from "vitest";
import {
  AreaIndefinidaError,
  rootTeams,
  soleRootTeam,
} from "../areas";
import type { Team } from "../api";

function time(id: string, nome: string, parent: string | null): Team {
  return {
    id,
    workspace_id: "ws",
    parent_team_id: parent,
    name: nome,
    slug: id,
  };
}

const MARKETING = time("t-mkt", "Marketing", null);
const TI = time("t-ti", "TI", null);
const SEO = time("t-seo", "SEO", "t-mkt");

describe("rootTeams", () => {
  it("devolve só os times sem pai", () => {
    expect(rootTeams([MARKETING, SEO, TI]).map((t) => t.id)).toEqual([
      "t-mkt",
      "t-ti",
    ]);
  });

  it("ordena por NOME, e não pela ordem em que a API respondeu", () => {
    // ⚠️ O PONTO DA FATIA: a ordem da API não é contrato de ninguém. Se ela
    // mudar (um `VACUUM` basta), qualquer tela que dependa de "a primeira"
    // passa a olhar para outra área -- sem erro e sem teste vermelho.
    const comoVeioDaApi = [TI, MARKETING];
    expect(rootTeams(comoVeioDaApi).map((t) => t.name)).toEqual([
      "Marketing",
      "TI",
    ]);
  });

  it("ordena respeitando acento (pt-BR)", () => {
    const arte = time("t-arte", "Ártico", null);
    expect(rootTeams([TI, arte, MARKETING]).map((t) => t.name)).toEqual([
      "Ártico",
      "Marketing",
      "TI",
    ]);
  });

  it("sem raiz nenhuma, lista vazia", () => {
    expect(rootTeams([SEO])).toEqual([]);
  });
});

describe("soleRootTeam", () => {
  it("com UMA área, devolve ela -- o caso de hoje", () => {
    expect(soleRootTeam([MARKETING, SEO]).id).toBe("t-mkt");
  });

  it("⭐ com DUAS áreas, LEVANTA em vez de escolher", () => {
    // ⚠️ ESTE É O TESTE QUE A SPEC PEDIU, e o único do projeto que prova a
    // diferença entre "a raiz" e "uma das raízes". Trocar a implementação de
    // volta por `teams.find(...)` faz este teste cair, e só ele.
    expect(() => soleRootTeam([MARKETING, TI, SEO])).toThrow(
      AreaIndefinidaError,
    );
  });

  it("com duas áreas, o erro diz o MOTIVO e QUAIS são", () => {
    // ⚠️ Os dois motivos pedem conversas diferentes: "nenhuma" é workspace
    // quebrado; "varias" é a tela precisando saber de qual área se fala. Um
    // `catch` que trate os dois igual diz a frase errada em metade dos casos.
    try {
      soleRootTeam([MARKETING, TI]);
      throw new Error("deveria ter levantado");
    } catch (e) {
      expect(e).toBeInstanceOf(AreaIndefinidaError);
      const erro = e as AreaIndefinidaError;
      expect(erro.motivo).toBe("varias");
      // Ordenado, como `rootTeams` -- a lista do erro não pode ser sorteada
      // tampouco, senão a mensagem muda de um carregamento para o outro.
      expect(erro.areas).toEqual(["t-mkt", "t-ti"]);
    }
  });

  it("⭐ sem área nenhuma, LEVANTA -- a dívida da ADR 0001 sendo paga", () => {
    // Antes desta fatia isto devolvia `null`, e o `null` virava "o backend
    // que decida" -- a herança silenciosa que a ADR mandava matar quando
    // subtimes existissem. Existem desde a Entrega 13.
    try {
      soleRootTeam([SEO]);
      throw new Error("deveria ter levantado");
    } catch (e) {
      expect((e as AreaIndefinidaError).motivo).toBe("nenhuma");
      expect((e as AreaIndefinidaError).areas).toEqual([]);
    }
  });

  it("lista vazia (ainda carregando, ou falha) também levanta", () => {
    expect(() => soleRootTeam([])).toThrow(AreaIndefinidaError);
  });

  it("a mensagem é legível por quem não escreveu o código", () => {
    // Ela chega no console de quem está com a tela aberta -- e, na fatia 4,
    // provavelmente na própria tela.
    try {
      soleRootTeam([MARKETING, TI]);
    } catch (e) {
      expect((e as Error).message).toContain("mais de uma área");
    }
  });
});
