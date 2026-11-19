import { describe, expect, it } from "vitest";

import type { Project, ProjectLabel } from "@/lib/api";
import { agruparPorCategoria, casaBusca } from "@/lib/projetos";

const rotulo = (id: string, name: string): ProjectLabel => ({
  id,
  team_id: "mkt",
  name,
  color: "gray",
});

function projeto(over: Partial<Project> & { id: string }): Project {
  return {
    title: `Projeto ${over.id}`,
    description: "",
    status: "ACTIVE",
    start_date: null,
    due_date: null,
    completed_at: null,
    team_id: "mkt",
    created_by: "u",
    created_at: "2026-11-19T12:00:00Z",
    updated_at: "2026-11-19T12:00:00Z",
    category: null,
    tags: [],
    can_update: true,
    can_delete: true,
    ...over,
  };
}

const EVENTOS = rotulo("c1", "Eventos");
const CAMPANHAS = rotulo("c2", "campanhas");
const ULTIMA = rotulo("c3", "Ações");

describe("agruparPorCategoria", () => {
  it("ordem alfabética sem caixa nem acento, e sem categoria por último", () => {
    const grupos = agruparPorCategoria([
      projeto({ id: "1" }),
      projeto({ id: "2", category: EVENTOS }),
      projeto({ id: "3", category: CAMPANHAS }),
      projeto({ id: "4", category: EVENTOS }),
      projeto({ id: "5", category: ULTIMA }),
    ]);
    expect(grupos.map((g) => g.categoria?.name ?? null)).toEqual([
      "Ações",
      "campanhas",
      "Eventos",
      null,
    ]);
    // Dentro da seção, a ordem do servidor.
    expect(grupos[2].projetos.map((p) => p.id)).toEqual(["2", "4"]);
  });

  it("sem projeto sem categoria, não há a seção", () => {
    const grupos = agruparPorCategoria([projeto({ id: "1", category: EVENTOS })]);
    expect(grupos).toHaveLength(1);
  });

  it("lista vazia, nenhum grupo", () => {
    expect(agruparPorCategoria([])).toEqual([]);
  });
});

describe("casaBusca", () => {
  const p = projeto({
    id: "1",
    title: "Feira do Vestibular",
    description: "**Stand** no shopping",
    category: EVENTOS,
    tags: [rotulo("t1", "Mídia paga")],
  });

  it.each([
    ["título", "vestib"],
    ["descrição sem a marcação", "stand no"],
    ["categoria", "evento"],
    ["tag, sem acento", "midia"],
    ["termo vazio", "  "],
  ])("casa pelo %s", (_, termo) => {
    expect(casaBusca(p, termo)).toBe(true);
  });

  it("não casa o que não está em lugar nenhum", () => {
    expect(casaBusca(p, "formatura")).toBe(false);
  });
});
