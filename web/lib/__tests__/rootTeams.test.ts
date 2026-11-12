// Duas raízes montadas em memória: o caso que distingue "a raiz" de "uma das raízes".

import { describe, it, expect } from "vitest";
import {
  RootTeamUndefinedError,
  entradaDoQuadro,
  rootTeams,
  soleRootTeam,
  rootBoardUrl,
} from "../rootTeams";
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
  it("com UM time raiz, devolve ele", () => {
    expect(soleRootTeam([MARKETING, SEO]).id).toBe("t-mkt");
  });

  it("⭐ com DOIS times raiz, LEVANTA em vez de escolher", () => {
    // Trocar a implementação por `teams.find(...)` faz este teste cair.
    expect(() => soleRootTeam([MARKETING, TI, SEO])).toThrow(
      RootTeamUndefinedError,
    );
  });

  it("com dois times raiz, o erro diz o MOTIVO e QUAIS são", () => {
    try {
      soleRootTeam([MARKETING, TI]);
      throw new Error("deveria ter levantado");
    } catch (e) {
      expect(e).toBeInstanceOf(RootTeamUndefinedError);
      const erro = e as RootTeamUndefinedError;
      expect(erro.motivo).toBe("varias");
      // Ordenado como `rootTeams`, para a mensagem não mudar entre carregamentos.
      expect(erro.rootIds).toEqual(["t-mkt", "t-ti"]);
    }
  });

  it("⭐ sem time raiz nenhum, LEVANTA", () => {
    try {
      soleRootTeam([SEO]);
      throw new Error("deveria ter levantado");
    } catch (e) {
      expect((e as RootTeamUndefinedError).motivo).toBe("nenhuma");
      expect((e as RootTeamUndefinedError).rootIds).toEqual([]);
    }
  });

  it("lista vazia (ainda carregando, ou falha) também levanta", () => {
    expect(() => soleRootTeam([])).toThrow(RootTeamUndefinedError);
  });

  it("a mensagem é legível por quem não escreveu o código", () => {
    try {
      soleRootTeam([MARKETING, TI]);
    } catch (e) {
      expect((e as Error).message).toContain("mais de um time");
    }
  });
});

describe("rootBoardUrl", () => {
  it("é /quadro/<id>", () => {
    expect(rootBoardUrl("t-ti")).toBe("/quadro/t-ti");
  });
});

describe("entradaDoQuadro", () => {
  it("um time raiz só: desenha", () => {
    expect(entradaDoQuadro([MARKETING, SEO])).toEqual({
      tipo: "desenhar",
      rootId: "t-mkt",
    });
  });

  it("⭐ vários times raiz: redireciona em vez de escolher calado", () => {
    expect(entradaDoQuadro([MARKETING, TI])).toEqual({
      tipo: "redirecionar",
      para: "/quadro/t-mkt",
    });
  });

  it("⚠️ o destino é o PRIMEIRO DA LISTA, e a lista é do chamador", () => {
    // Ordenar aqui destruiria a preferência montada pelo chamador.
    expect(entradaDoQuadro([TI, MARKETING])).toEqual({
      tipo: "redirecionar",
      para: "/quadro/t-ti",
    });
    expect(entradaDoQuadro([MARKETING, TI])).toEqual({
      tipo: "redirecionar",
      para: "/quadro/t-mkt",
    });
  });

  it("sem time raiz nenhum: não inventa destino", () => {
    expect(entradaDoQuadro([])).toEqual({ tipo: "sem-raiz" });
  });

  it("⚠️ subtime passado por engano não vira destino de entrada", () => {
    expect(entradaDoQuadro([SEO])).toEqual({ tipo: "sem-raiz" });
  });
});
