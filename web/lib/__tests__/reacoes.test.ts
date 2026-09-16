/**
 * Spec 050 -- as decisoes da fileira de reacoes.
 *
 * Estes testes espelham o backend: a fileira que o servidor devolve
 * (`test_comment_reactions_db.py`) e o que a tela faz com ela.
 */

import { describe, expect, it } from "vitest";
import {
  REACOES_SUGERIDAS,
  acaoDaPilula,
  filtrarCatalogo,
  minhaReacao,
  porGrupo,
  rotuloDeQuemReagiu,
  type EmojiDoCatalogo,
  type Reacao,
} from "../reacoes";

const EU = "user-eu";
const ANA = "user-ana";
const BRUNO = "user-bruno";

const MEMBROS = new Map([
  [EU, { name: "Camila" }],
  [ANA, { name: "Ana" }],
  [BRUNO, { name: "Bruno" }],
]);

const FILEIRA: Reacao[] = [
  { emoji: "❤️", user_ids: [ANA, EU] },
  { emoji: "👍", user_ids: [BRUNO] },
];

describe("minhaReacao", () => {
  it("acha a minha entre as pilulas", () => {
    expect(minhaReacao(FILEIRA, EU)).toBe("❤️");
  });

  it("sem reacao minha, null", () => {
    expect(minhaReacao(FILEIRA, "outro")).toBeNull();
  });

  it("sem pessoa logada (ainda carregando), null", () => {
    expect(minhaReacao(FILEIRA, null)).toBeNull();
    expect(minhaReacao(FILEIRA, undefined)).toBeNull();
  });
});

describe("acaoDaPilula", () => {
  it("clicar na minha TIRA", () => {
    expect(acaoDaPilula(FILEIRA, "❤️", EU)).toBe("tirar");
  });

  it("clicar na de outro emoji TROCA a minha para ele", () => {
    expect(acaoDaPilula(FILEIRA, "👍", EU)).toBe("por");
  });

  it("quem nao reagiu, poe", () => {
    expect(acaoDaPilula(FILEIRA, "❤️", "outro")).toBe("por");
  });
});

describe("rotuloDeQuemReagiu", () => {
  it("poe 'você' por ultimo, mesmo tendo reagido primeiro", () => {
    expect(rotuloDeQuemReagiu([EU, ANA], MEMBROS, EU)).toBe("Ana e você");
  });

  it("tres pessoas: virgula nas primeiras, 'e' na ultima", () => {
    expect(rotuloDeQuemReagiu([ANA, BRUNO, EU], MEMBROS, EU)).toBe(
      "Ana, Bruno e você",
    );
  });

  it("uma pessoa so, sem 'e'", () => {
    expect(rotuloDeQuemReagiu([ANA], MEMBROS, EU)).toBe("Ana");
  });

  it("⚠️ quem nao esta no mapa vira 'alguém', nunca o id cru", () => {
    const texto = rotuloDeQuemReagiu(["fantasma"], MEMBROS, EU);
    expect(texto).toBe("alguém");
    expect(texto).not.toContain("fantasma");
  });

  it("lista vazia, rotulo vazio", () => {
    expect(rotuloDeQuemReagiu([], MEMBROS, EU)).toBe("");
  });
});

describe("filtrarCatalogo", () => {
  const catalogo: EmojiDoCatalogo[] = [
    {
      emoji: "👍",
      nome: "polegar para cima",
      tags: ["joia", "beleza", "valeu"],
      grupo: "pessoas e corpo",
    },
    {
      emoji: "❤️",
      nome: "coração vermelho",
      tags: ["amor"],
      grupo: "sorrisos e emoção",
    },
    {
      emoji: "🎉",
      nome: "confete",
      tags: ["festa", "parabéns"],
      grupo: "atividades",
    },
  ];

  it("acha pelo nome", () => {
    expect(filtrarCatalogo(catalogo, "polegar").map((e) => e.emoji)).toEqual([
      "👍",
    ]);
  });

  it("acha pela etiqueta -- 'joia' acha o polegar", () => {
    expect(filtrarCatalogo(catalogo, "joia").map((e) => e.emoji)).toEqual([
      "👍",
    ]);
  });

  it("⚠️ sem acento acha com acento: 'coracao' acha 'coração'", () => {
    expect(filtrarCatalogo(catalogo, "coracao").map((e) => e.emoji)).toEqual([
      "❤️",
    ]);
    expect(filtrarCatalogo(catalogo, "parabens").map((e) => e.emoji)).toEqual([
      "🎉",
    ]);
  });

  it("caixa alta tambem acha", () => {
    expect(filtrarCatalogo(catalogo, "FESTA").map((e) => e.emoji)).toEqual([
      "🎉",
    ]);
  });

  it("termo vazio devolve vazio -- a grade mostra os grupos, nao tudo", () => {
    expect(filtrarCatalogo(catalogo, "")).toEqual([]);
    expect(filtrarCatalogo(catalogo, "   ")).toEqual([]);
  });

  it("respeita o limite -- a grade nao desenha 1.949 botoes", () => {
    const muitos: EmojiDoCatalogo[] = Array.from({ length: 200 }, (_, i) => ({
      emoji: `e${i}`,
      nome: "coisa",
      tags: [],
      grupo: "g",
    }));
    expect(filtrarCatalogo(muitos, "coisa", 10)).toHaveLength(10);
  });

  it("nada casa, lista vazia", () => {
    expect(filtrarCatalogo(catalogo, "zzz")).toEqual([]);
  });
});

describe("porGrupo", () => {
  it("agrupa preservando a ordem do arquivo gerado", () => {
    const catalogo: EmojiDoCatalogo[] = [
      { emoji: "😀", nome: "a", tags: [], grupo: "sorrisos e emoção" },
      { emoji: "👍", nome: "b", tags: [], grupo: "pessoas e corpo" },
      { emoji: "😉", nome: "c", tags: [], grupo: "sorrisos e emoção" },
    ];
    expect(porGrupo(catalogo)).toEqual([
      {
        grupo: "sorrisos e emoção",
        itens: [catalogo[0], catalogo[2]],
      },
      { grupo: "pessoas e corpo", itens: [catalogo[1]] },
    ]);
  });
});

describe("REACOES_SUGERIDAS", () => {
  it("joia e coracao, na ordem pedida por ela", () => {
    expect(REACOES_SUGERIDAS).toEqual(["👍", "❤️"]);
  });

  it("⚠️ o coracao esta na forma COMPLETA (com U+FE0F)", () => {
    // Sem o U+FE0F o servidor normalizaria e a pilula voltaria com um emoji
    // diferente do que o botao mostrou.
    expect(REACOES_SUGERIDAS[1]).toBe("❤️");
  });
});
