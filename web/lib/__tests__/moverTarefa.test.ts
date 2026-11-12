import { describe, expect, it } from "vitest";

import type { Quadro, Team } from "../api";
import {
  caminhoDoAchado,
  corpoDoMover,
  destinoAtual,
  destinosDoMover,
  frasesDaPrevia,
} from "../moverTarefa";

const time = (id: string, name: string, parent: string | null = null): Team =>
  ({ id, name, parent_team_id: parent, workspace_id: "ws", slug: id }) as Team;
const quadro = (id: string, name: string, team_id: string, is_default = false): Quadro => ({
  id, name, team_id, is_default, colunas: [],
});

const TIMES = [
  time("mkt", "Marketing"),
  time("seo", "SEO", "mkt"),
  time("design", "Design", "mkt"),
  time("com", "Comercial"),
];

describe("destinosDoMover", () => {
  it("agrupa por time raiz: geral, lentes de subtime e avulsos", () => {
    const d = destinosDoMover(
      [
        quadro("g-mkt", "Geral", "mkt", true),
        quadro("artes", "Artes", "design"),
        quadro("g-com", "Geral", "com", true),
      ],
      TIMES,
    );
    expect(d.map((x) => [x.rootTeam, x.rotulo])).toEqual([
      ["Comercial", "Quadro geral · Comercial"],
      ["Marketing", "Quadro geral · Marketing"],
      ["Marketing", "Lente · Design"],
      ["Marketing", "Lente · SEO"],
      ["Marketing", "Artes · Design"],
    ]);
    expect(d.find((x) => x.rotulo === "Lente · SEO")).toMatchObject({
      board_id: "g-mkt",
      team_id: "seo",
    });
  });

  it("sem o Quadro geral do time (fora do alcance), nem lente nem avulso dele", () => {
    const d = destinosDoMover([quadro("g-mkt", "Geral", "mkt", true)], TIMES);
    expect(d.some((x) => x.rootTeam === "Comercial")).toBe(false);
  });
});

describe("destinoAtual", () => {
  const d = destinosDoMover(
    [quadro("g-mkt", "Geral", "mkt", true), quadro("artes", "Artes", "design")],
    TIMES,
  );
  it("casa a lente do time da tarefa no Quadro geral", () => {
    expect(destinoAtual(d, { board_id: "g-mkt", team_id: "seo" })?.rotulo).toBe("Lente · SEO");
  });
  it("tarefa da raiz cai no proprio Quadro geral", () => {
    expect(destinoAtual(d, { board_id: "g-mkt", team_id: "mkt" })?.rotulo).toBe("Quadro geral · Marketing");
  });
  it("quadro avulso casa pelo quadro", () => {
    expect(destinoAtual(d, { board_id: "artes", team_id: "design" })?.board_id).toBe("artes");
  });
});

describe("corpoDoMover", () => {
  const geral = { chave: "g", rotulo: "", rootTeam: "", board_id: "g", team_id: null };
  const lente = { ...geral, chave: "g:seo", team_id: "seo" };
  it("principal manda o quadro, e o time so na lente", () => {
    expect(corpoDoMover(geral, "principal", null)).toEqual({ board_id: "g" });
    expect(corpoDoMover(lente, "principal", null)).toEqual({ board_id: "g", team_id: "seo" });
  });
  it("subtarefa manda so a mae, e espera ela ser escolhida", () => {
    expect(corpoDoMover(geral, "subtarefa", null)).toBeNull();
    expect(corpoDoMover(geral, "subtarefa", "m")).toEqual({ parent_task_id: "m" });
  });
});

it("caminhoDoAchado poe a propria tarefa no fim", () => {
  expect(
    caminhoDoAchado({ id: "x", title: "Instagram", team_id: null, depth: 2, caminho: ["Natal", "Redes"] }),
  ).toBe("Natal › Redes › Instagram");
});

describe("frasesDaPrevia", () => {
  const base = {
    mudou: true, subtarefas: 0, projeto_antes: null, projeto_depois: null, saem: [], assume: 0,
    status_muda: [],
  };
  it("nada muda, nada a dizer", () => {
    expect(frasesDaPrevia({ ...base, mudou: false, subtarefas: 3 })).toEqual([]);
  });
  it("as quatro frases da spec, na ordem", () => {
    expect(
      frasesDaPrevia({
        ...base,
        subtarefas: 2,
        projeto_antes: "Natal",
        saem: [{ user_id: "u", nome: "Gi", tarefas: 3 }],
        assume: 1,
      }),
    ).toEqual([
      "Leva junto 2 subtarefas.",
      'Fica sem o projeto "Natal", que é de outro time.',
      "Gi não vê o destino e sai de 3 tarefas (recebe um aviso).",
      "Você vira responsável por 1 tarefa que ficaria sem ninguém.",
    ]);
  });
  it("avisa o status que muda, com o nome da tela (auditoria 11/11)", () => {
    expect(
      frasesDaPrevia({
        ...base,
        status_muda: [
          { de: "BLOCKED", para: "IN_PROGRESS", tarefas: 1 },
          { de: "PLANNED", para: "BACKLOG", tarefas: 3 },
        ],
      }),
    ).toEqual([
      "1 tarefa muda de status: Bloqueado → Em Andamento (o destino não tem essa coluna).",
      "3 tarefas mudam de status: Planejado → Backlog (o destino não tem essa coluna).",
    ]);
  });
  it("trocar de projeto e diferente de perder", () => {
    expect(frasesDaPrevia({ ...base, projeto_antes: "A", projeto_depois: "B" })).toEqual([
      'Sai do projeto "A" e entra em "B".',
    ]);
  });
});
