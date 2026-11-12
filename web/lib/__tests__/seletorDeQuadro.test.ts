/**
 * O seletor de quadro da tela do time. O que este arquivo prende é a
 * distinção entre LENTE e QUADRO: a lente não existe como registro (sem
 * `board_id`), então não se renomeia nem se apaga. Não é segurança (o backend
 * trava); aqui só se evita oferecer botão que o servidor vai recusar.
 */

import { describe, expect, it } from "vitest";

import type { Quadro } from "@/lib/api";
import {
  DESCRICAO_DA_LENTE,
  alcanceDeQuadro,
  nomeDeQuadroValido,
  opcaoSelecionada,
  opcoesDoSeletor,
  opcoesDoSeletorDaRaiz,
  podeApagarQuadros,
  podeGerirQuadrosDe,
  resolverQuadroPedido,
  urlDoQuadro,
} from "@/lib/seletorDeQuadro";

const RAIZ = "team-marketing";
const SEO = "team-seo";
const CRM = "team-crm";

function quadro(over: Partial<Quadro> & { id: string; name: string }): Quadro {
  return {
    team_id: SEO,
    is_default: false,
    colunas: [],
    ...over,
  };
}

/** O mundo que um supervisor do SEO alcanca: o geral + o dele + o do CRM? Nao. */
const QUADROS: Quadro[] = [
  quadro({ id: "b-geral", name: "Quadro geral", team_id: RAIZ, is_default: true }),
  quadro({ id: "b-pauta", name: "Pauta editorial", team_id: SEO }),
  quadro({ id: "b-links", name: "Construção de links", team_id: SEO }),
  quadro({ id: "b-crm", name: "Automações", team_id: CRM }),
];

describe("alcanceDeQuadro", () => {
  it("sem usuario, alcance nenhum", () => {
    expect(alcanceDeQuadro(null).tipo).toBe("nenhum");
  });

  it("⚠️ root -> amplo, e GANHA de subteam quando o ator tem os dois", () => {
    // ADMIN e MANAGER têm os dois. Com a ordem invertida, um ADMIN sem subtime
    // cairia em `subtime: []` e perderia o botão em todo time.
    const a = alcanceDeQuadro({
      permissions: ["board.update", "board.update.root"],
      teams: [],
    });
    expect(a.tipo).toBe("amplo");
  });

  it("so subteam -> lista os subtimes onde e SUPERVISOR", () => {
    const a = alcanceDeQuadro({
      permissions: ["board.update"],
      teams: [
        { team_id: SEO, role: "SUPERVISOR" },
        { team_id: CRM, role: "OPERATOR" },
      ],
    });
    expect(a).toEqual({ tipo: "subtime", subtimes: [SEO] });
  });

  it("sem permissao nenhuma -> nenhum", () => {
    expect(
      alcanceDeQuadro({ permissions: ["task.create"], teams: [] }).tipo,
    ).toBe("nenhum");
  });
});

describe("podeApagar", () => {
  it("⚠️ renomear e apagar vêm de verbos diferentes: o GESTOR renomeia e não apaga", () => {
    const avulsos = opcoesDoSeletor(QUADROS, SEO, true, false).filter(
      (o) => o.id !== null,
    );
    expect(avulsos.length).toBeGreaterThan(0);
    for (const o of avulsos) {
      expect(o.podeRenomear).toBe(true);
      expect(o.podeApagar).toBe(false);
    }
  });

  it("na raiz também: o geral nunca se apaga, e o avulso segue o verbo", () => {
    const [geral, ...avulsos] = opcoesDoSeletorDaRaiz(QUADROS, RAIZ, true, false);
    expect(geral.podeApagar).toBe(false);
    for (const o of avulsos) expect(o.podeApagar).toBe(false);
  });

  it("podeApagarQuadros: um verbo por nível, igual ao backend", () => {
    expect(podeApagarQuadros(["board.delete.root"], true)).toBe(true);
    expect(podeApagarQuadros(["board.delete.root"], false)).toBe(false);
    expect(podeApagarQuadros(["board.delete"], false)).toBe(true);
    expect(podeApagarQuadros(["board.delete"], true)).toBe(false);
    // o GESTOR: edita nos dois níveis, apaga em nenhum
    expect(
      podeApagarQuadros(["board.update.root", "board.update"], true),
    ).toBe(false);
  });
});

describe("podeGerirQuadrosDe", () => {
  it("amplo pode em qualquer time", () => {
    expect(podeGerirQuadrosDe({ tipo: "amplo" }, CRM)).toBe(true);
  });

  it("⚠️ supervisor SO no proprio subtime", () => {
    // O mapa de permissão sozinho responde errado aqui: sem conferir a lista,
    // a tela ofereceria "novo quadro" no time alheio (403 depois de digitar).
    const a = { tipo: "subtime", subtimes: [SEO] } as const;
    expect(podeGerirQuadrosDe(a, SEO)).toBe(true);
    expect(podeGerirQuadrosDe(a, CRM)).toBe(false);
  });

  it("nenhum nunca pode", () => {
    expect(podeGerirQuadrosDe({ tipo: "nenhum" }, SEO)).toBe(false);
  });
});

describe("opcoesDoSeletor", () => {
  it("a LENTE vem sempre primeiro, e com a descricao fixa", () => {
    const [primeira] = opcoesDoSeletor(QUADROS, SEO, true, true);
    expect(primeira.id).toBeNull();
    expect(primeira.descricao).toBe(DESCRICAO_DA_LENTE);
  });

  it("⚠️ a lente NUNCA tem afordancia de renomear -- nem para quem pode tudo", () => {
    // Ausente, e não desabilitada: a lente não existe como registro.
    const [lente] = opcoesDoSeletor(QUADROS, SEO, true, true);
    expect(lente.podeRenomear).toBe(false);
  });

  it("⚠️ so os quadros DAQUELE time entram", () => {
    // `GET /boards` devolve tudo que a pessoa alcança; para um ADMIN, os
    // quadros de todos os subtimes.
    const nomes = opcoesDoSeletor(QUADROS, SEO, true, true).map((o) => o.nome);
    expect(nomes).not.toContain("Automações");
  });

  it("⚠️ o quadro PADRAO nao entra -- a lente ja o representa", () => {
    // Listá-lo poria a mesma coisa duas vezes no menu.
    const nomes = opcoesDoSeletor(QUADROS, RAIZ, true, true).map((o) => o.nome);
    expect(nomes).not.toContain("Quadro geral");
    expect(nomes).toEqual(["Lente do time"]);
  });

  it("⚠️ ordena por NOME, e nao pela ordem que a API devolveu", () => {
    // `GET /boards` não promete ordem.
    const nomes = opcoesDoSeletor(QUADROS, SEO, true, true).map((o) => o.nome);
    expect(nomes).toEqual([
      "Lente do time",
      "Construção de links",
      "Pauta editorial",
    ]);
  });

  it("sem permissao, os avulsos aparecem mas sem renomear", () => {
    // Quem alcança o quadro pela lente alcança o conteúdo; some só o editar.
    const opcoes = opcoesDoSeletor(QUADROS, SEO, false, false);
    expect(opcoes).toHaveLength(3);
    expect(opcoes.every((o) => !o.podeRenomear)).toBe(true);
  });

  it("time sem quadro avulso mostra so a lente", () => {
    expect(opcoesDoSeletor([], SEO, true, true)).toHaveLength(1);
  });
});

describe("opcaoSelecionada", () => {
  const OPCOES = opcoesDoSeletor(QUADROS, SEO, true, true);

  it("acha pelo id", () => {
    expect(opcaoSelecionada(OPCOES, "b-pauta").nome).toBe("Pauta editorial");
  });

  it("null seleciona a lente", () => {
    expect(opcaoSelecionada(OPCOES, null).id).toBeNull();
  });

  it("⚠️ id que nao existe mais cai na LENTE, sem erro", () => {
    // Quadro apagado por outra pessoa, ou link velho.
    expect(opcaoSelecionada(OPCOES, "b-que-sumiu").id).toBeNull();
  });
});

describe("urlDoQuadro", () => {
  it("lente e a URL sem parametro", () => {
    expect(urlDoQuadro("t1", null)).toBe("/quadro/t1");
  });

  it("quadro vira parametro", () => {
    expect(urlDoQuadro("t1", "b1")).toBe("/quadro/t1?quadro=b1");
  });
});

describe("nomeDeQuadroValido", () => {

  it("apara os espacos", () => {
    expect(nomeDeQuadroValido("  Pauta  ")).toBe("Pauta");
  });

  it("⚠️ so espaco NAO e nome", () => {
    expect(nomeDeQuadroValido("   ")).toBeNull();
  });

  it("vazio nao e nome", () => {
    expect(nomeDeQuadroValido("")).toBeNull();
  });

  it("⚠️ 255 passa, 256 nao -- e o teto e o do QUADRO", () => {
    // Coluna tem outro teto (120): reaproveitar esta função para coluna
    // deixaria passar nome que o Postgres recusa com 500.
    expect(nomeDeQuadroValido("x".repeat(255))).toHaveLength(255);
    expect(nomeDeQuadroValido("x".repeat(256))).toBeNull();
  });
});

describe("opcoesDoSeletor -- afordância de apagar", () => {
  it("⚠️ a LENTE nunca oferece apagar, nem para quem gere", () => {
    const opcoes = opcoesDoSeletor(QUADROS, SEO, true, true);
    expect(opcoes[0].id).toBeNull();
    expect(opcoes[0].podeApagar).toBe(false);
  });

  it("sem permissão, quadro avulso não oferece apagar", () => {
    const opcoes = opcoesDoSeletor(QUADROS, SEO, false, false);
    expect(opcoes.every((o) => !o.podeApagar)).toBe(true);
  });
});

describe("resolverQuadroPedido: a queda avisa", () => {
  // Caso típico: uma pessoa apaga o quadro que a outra tem aberto.
  const QUADROS = [
    { id: "b-geral", name: "Quadro geral", team_id: "raiz", is_default: true, colunas: [] },
    { id: "b-pauta", name: "Pauta", team_id: SEO, is_default: false, colunas: [] },
    { id: "b-crm", name: "Automações", team_id: CRM, is_default: false, colunas: [] },
  ];

  it("pedido válido: devolve o id e NÃO avisa", () => {
    expect(resolverQuadroPedido("b-pauta", QUADROS, SEO)).toEqual({
      id: "b-pauta",
      motivo: null,
    });
  });

  it("sem `?quadro=`: lente, sem aviso", () => {
    expect(resolverQuadroPedido(null, QUADROS, SEO)).toEqual({
      id: null,
      motivo: null,
    });
  });

  it("⚠️ lista AINDA NÃO CHEGOU: devolve o pedido e NÃO avisa", () => {
    // `null` é "carregando": avisar aqui faria o aviso piscar em todo
    // carregamento.
    expect(resolverQuadroPedido("b-pauta", null, SEO)).toEqual({
      id: "b-pauta",
      motivo: null,
    });
  });

  it("⚠️ id que não está na lista: cai na lente E avisa", () => {
    // Apagado, nunca existiu, ou fora de alcance -- as três indistinguíveis
    // daqui, e a ação de quem olha é a mesma nas três.
    expect(resolverQuadroPedido("b-morto", QUADROS, SEO)).toEqual({
      id: null,
      motivo: "fora-de-alcance",
    });
  });

  it("⚠️ quadro de OUTRO time tem mensagem própria", () => {
    // Tem conserto: a pessoa está na página errada (link colado de outro time).
    expect(resolverQuadroPedido("b-crm", QUADROS, SEO)).toEqual({
      id: null,
      motivo: "outro-time",
    });
  });

  it("⚠️ pedir o Quadro geral não é erro -- é pedir onde a pessoa já está", () => {
    // Nesta tela quem o representa é a LENTE.
    expect(resolverQuadroPedido("b-geral", QUADROS, SEO)).toEqual({
      id: null,
      motivo: "e-o-quadro-geral",
    });
  });
});

describe("opcoesDoSeletorDaRaiz: a tela do Quadro geral", () => {
  const RAIZ = "raiz";
  const QUADROS = [
    { id: "b-geral", name: "Quadro geral", team_id: RAIZ, is_default: true, colunas: [] },
    { id: "b-camp", name: "Campanhas 2027", team_id: RAIZ, is_default: false, colunas: [] },
    { id: "b-pauta", name: "Pauta", team_id: SEO, is_default: false, colunas: [] },
  ];

  it("⚠️ o QUADRO GERAL É A PRIMEIRA OPÇÃO, pelo nome dele", () => {
    // Na raiz não há lente: o que a lente espelha é o próprio geral.
    const o = opcoesDoSeletorDaRaiz(QUADROS, RAIZ, true, true);
    expect(o[0].nome).toBe("Quadro geral");
    // Com id de verdade: `null` é a lente.
    expect(o[0].id).toBe("b-geral");
  });

  it("⚠️ o Quadro geral NUNCA pode ser apagado, nem para quem gere", () => {
    // O backend recusa com `quadro_padrao_nao_apagavel`.
    expect(opcoesDoSeletorDaRaiz(QUADROS, RAIZ, true, true)[0].podeApagar).toBe(false);
  });

  it("mas PODE ser renomeado", () => {
    expect(opcoesDoSeletorDaRaiz(QUADROS, RAIZ, true, true)[0].podeRenomear).toBe(true);
    expect(opcoesDoSeletorDaRaiz(QUADROS, RAIZ, false, false)[0].podeRenomear).toBe(false);
  });

  it("os avulsos DA RAIZ entram depois, em ordem de nome", () => {
    const o = opcoesDoSeletorDaRaiz(QUADROS, RAIZ, true, true);
    expect(o.map((x) => x.nome)).toEqual(["Quadro geral", "Campanhas 2027"]);
  });

  it("⚠️ quadro de OUTRO time não entra", () => {
    const nomes = opcoesDoSeletorDaRaiz(QUADROS, RAIZ, true, true).map((x) => x.nome);
    expect(nomes).not.toContain("Pauta");
  });

  it("sem o geral na lista, não inventa uma opção", () => {
    // Acontece se o `listBoards` falhar e cair em `[]`.
    const o = opcoesDoSeletorDaRaiz([QUADROS[1]], RAIZ, true, true);
    expect(o.map((x) => x.nome)).toEqual(["Campanhas 2027"]);
  });
});
