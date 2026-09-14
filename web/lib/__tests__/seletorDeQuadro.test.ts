/**
 * Spec 036, fatia 5b-6 -- o seletor de quadro da tela do time.
 *
 * ⚠️ O QUE ESTE ARQUIVO PRENDE E A DISTINCAO ENTRE LENTE E QUADRO. Elas
 * convivem no mesmo menu porque, para quem usa, sao dois lugares onde a tarefa
 * pode estar. Mas a lente nao existe como registro (ADR 0034): nao tem
 * `board_id`, nao se renomeia, nao se apaga. Um seletor que as trate igual
 * oferece "renomear" numa coisa que nao existe -- e o backend responde 404 a
 * uma requisicao que a tela nunca deveria ter deixado sair.
 *
 * ⚠️ ISTO NAO E SEGURANCA. O backend trava de verdade. Aqui so evitamos
 * oferecer botao que o servidor vai recusar.
 *
 * SABOTAGENS (medidas):
 *   M. `alcanceDeQuadro`: inverter a ordem -- `subteam` antes de `root`.
 *   N. `podeGerirQuadrosDe`: `subtime` devolve `true` sem conferir a lista.
 *   O. `opcoesDoSeletor`: tirar o filtro `q.team_id === teamId`.
 *   P. `opcoesDoSeletor`: tirar o `!q.is_default`.
 *   Q. `OpcaoDeQuadro` da lente com `podeRenomear: podeGerir`.
 */

import { describe, expect, it } from "vitest";

import type { Quadro } from "@/lib/api";
import {
  DESCRICAO_DA_LENTE,
  alcanceDeQuadro,
  nomeConfere,
  nomeDeQuadroValido,
  opcaoSelecionada,
  opcoesDoSeletor,
  opcoesDoSeletorDaRaiz,
  podeGerirQuadrosDe,
  quadroPedidoNaUrl,
  resolverQuadroPedido,
  TEXTO_DA_QUEDA,
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

  it("board.manage.root -> amplo", () => {
    const a = alcanceDeQuadro({
      permissions: ["board.update.root", "board.update"],
      teams: [],
    });
    expect(a.tipo).toBe("amplo");
  });

  it("⚠️ root GANHA de subteam quando o ator tem os dois", () => {
    // ⚠️ E ADMIN E MANAGER TEM OS DOIS. O mapa de permissoes do backend e
    // uniao de papeis, e `board.manage.subteam` entra em SUPERVISOR, MANAGER e
    // ADMIN -- se entrasse so no supervisor, o supervisor criaria quadro e o
    // ADMIN nao. Aqui a consequencia e outra: com a ordem invertida, um ADMIN
    // sem subtime nenhum cairia em `subtime: []` e perderia o botao em TODO
    // time. E ele e quem administra os subtimes de que nao e supervisor.
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

describe("podeGerirQuadrosDe", () => {
  it("amplo pode em qualquer time", () => {
    expect(podeGerirQuadrosDe({ tipo: "amplo" }, CRM)).toBe(true);
  });

  it("⚠️ supervisor SO no proprio subtime", () => {
    // ⚠️ A CELULA QUE O MAPA DE PERMISSAO SOZINHO RESPONDE ERRADO, e a mesma
    // que o backend guarda em `_assert_pode_gerir`. Sem a conferencia da
    // lista, a tela ofereceria "novo quadro" no time alheio e a pessoa levaria
    // 403 depois de digitar o nome.
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
    const [primeira] = opcoesDoSeletor(QUADROS, SEO, true);
    expect(primeira.id).toBeNull();
    expect(primeira.descricao).toBe(DESCRICAO_DA_LENTE);
  });

  it("⚠️ a lente NUNCA tem afordancia de renomear -- nem para quem pode tudo", () => {
    // ADR 0034 item 2: ausente, e nao desabilitada. Nao ha o que renomear --
    // a lente nao existe como registro no banco.
    const [lente] = opcoesDoSeletor(QUADROS, SEO, true);
    expect(lente.podeRenomear).toBe(false);
  });

  it("⚠️ so os quadros DAQUELE time entram", () => {
    // ⚠️ `GET /boards` devolve tudo que a pessoa ALCANCA -- para um ADMIN,
    // isso inclui os quadros de todos os subtimes. Sem o filtro, o seletor do
    // SEO listaria "Automações" (do CRM), e criar tarefa ali a mandaria para
    // um quadro que ninguem do SEO ve.
    const nomes = opcoesDoSeletor(QUADROS, SEO, true).map((o) => o.nome);
    expect(nomes).not.toContain("Automações");
  });

  it("⚠️ o quadro PADRAO nao entra -- a lente ja o representa", () => {
    // Lista-lo poria a mesma coisa duas vezes no menu, uma delas com botao de
    // renomear que a outra nao tem.
    const nomes = opcoesDoSeletor(QUADROS, RAIZ, true).map((o) => o.nome);
    expect(nomes).not.toContain("Quadro geral");
    expect(nomes).toEqual(["Lente do time"]);
  });

  it("⚠️ ordena por NOME, e nao pela ordem que a API devolveu", () => {
    // `GET /boards` nao promete ordem. Sem isto o menu se reordena sozinho
    // entre dois carregamentos, e o item que a pessoa ia clicar muda de lugar.
    const nomes = opcoesDoSeletor(QUADROS, SEO, true).map((o) => o.nome);
    expect(nomes).toEqual([
      "Lente do time",
      "Construção de links",
      "Pauta editorial",
    ]);
  });

  it("sem permissao, os avulsos aparecem mas sem renomear", () => {
    // ⚠️ VER continua valendo: quem alcanca o quadro pela lente alcanca o
    // conteudo dele. O que some e a afordancia de EDITAR.
    const opcoes = opcoesDoSeletor(QUADROS, SEO, false);
    expect(opcoes).toHaveLength(3);
    expect(opcoes.every((o) => !o.podeRenomear)).toBe(true);
  });

  it("time sem quadro avulso mostra so a lente", () => {
    expect(opcoesDoSeletor([], SEO, true)).toHaveLength(1);
  });
});

describe("opcaoSelecionada", () => {
  const OPCOES = opcoesDoSeletor(QUADROS, SEO, true);

  it("acha pelo id", () => {
    expect(opcaoSelecionada(OPCOES, "b-pauta").nome).toBe("Pauta editorial");
  });

  it("null seleciona a lente", () => {
    expect(opcaoSelecionada(OPCOES, null).id).toBeNull();
  });

  it("⚠️ id que nao existe mais cai na LENTE, sem erro", () => {
    // O quadro pode ter sido apagado por outra pessoa, ou o id pode vir de um
    // link velho. Mostrar erro para quem so abriu a tela seria pior que
    // mostrar o lugar padrao dela.
    expect(opcaoSelecionada(OPCOES, "b-que-sumiu").id).toBeNull();
  });
});

describe("quadroPedidoNaUrl", () => {
  const CRM = "team-crm";
  const OUTRO = "team-design";
  const avulso = (id: string, team: string): Quadro =>
    ({ id, name: `Quadro ${id}`, team_id: team, is_default: false, colunas: [] } as unknown as Quadro);
  const geral = (id: string, team: string): Quadro =>
    ({ id, name: "Quadro geral", team_id: team, is_default: true, colunas: [] } as unknown as Quadro);

  it("sem parametro, e a lente", () => {
    expect(quadroPedidoNaUrl(null, [avulso("b1", CRM)], CRM)).toBeNull();
    expect(quadroPedidoNaUrl("", [avulso("b1", CRM)], CRM)).toBeNull();
  });

  it("parametro que existe naquele time passa", () => {
    expect(quadroPedidoNaUrl("b1", [avulso("b1", CRM)], CRM)).toBe("b1");
  });

  it("⚠️ com a lista AINDA NAO CARREGADA, confia no parametro", () => {
    // ⚠️ `null` e "nao chegou", nao "nao ha quadros". Conferindo aqui, toda
    // carga de pagina derrubaria a selecao para a lente por um instante e a
    // tela piscaria a lente antes de mostrar o quadro pedido.
    expect(quadroPedidoNaUrl("b1", null, CRM)).toBe("b1");
  });

  it("⚠️ quadro de OUTRO time cai na lente", () => {
    // `listBoards` devolve tudo que a pessoa alcanca. Sem esta trava,
    // `/quadro/{timeA}?quadro={quadroDoTimeB}` desenharia o quadro de B sob a
    // pagina de A -- e o seletor, que filtra por time, ficaria sem aba
    // marcada: corpo mostrando um quadro, cabecalho dizendo "Lente do time".
    expect(quadroPedidoNaUrl("b2", [avulso("b2", OUTRO)], CRM)).toBeNull();
  });

  it("id inexistente cai na lente, sem erro", () => {
    // Link velho, ou quadro apagado por outra pessoa.
    expect(quadroPedidoNaUrl("sumiu", [avulso("b1", CRM)], CRM)).toBeNull();
  });

  it("⚠️ o Quadro geral nao e uma opcao desta tela", () => {
    // Ele tem tela propria (`/quadro`) e nao aparece no seletor -- aceitar o
    // id dele aqui daria um corpo sem aba correspondente, igual ao caso do
    // time alheio.
    expect(quadroPedidoNaUrl("g1", [geral("g1", CRM)], CRM)).toBeNull();
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
    // Sem o `trim` antes da conferencia, "   " passaria e o backend devolveria
    // 422 -- erro depois de digitar, para uma regra que a tela ja conhecia.
    expect(nomeDeQuadroValido("   ")).toBeNull();
  });

  it("vazio nao e nome", () => {
    expect(nomeDeQuadroValido("")).toBeNull();
  });

  it("⚠️ 255 passa, 256 nao -- e o teto e o do QUADRO", () => {
    // ⚠️ Coluna tem outro teto (120). Reaproveitar esta funcao para coluna
    // deixaria passar um nome que o Postgres recusa com
    // `StringDataRightTruncation`, que sai como 500.
    expect(nomeDeQuadroValido("x".repeat(255))).toHaveLength(255);
    expect(nomeDeQuadroValido("x".repeat(256))).toBeNull();
  });
});

describe("nomeConfere -- a trava de apagar quadro", () => {
  // ⚠️ É A ÚNICA COISA ENTRE UM CLIQUE E APAGAR AS TAREFAS DE OUTRAS PESSOAS.
  // Apagar quadro não pergunta o destino delas, e não há desfazer na tela.
  it("nome exato confere", () => {
    expect(nomeConfere("Campanhas", "Campanhas")).toBe(true);
  });

  it("⚠️ vazio NUNCA confere", () => {
    // Sem esta linha, abrir o diálogo e clicar em confirmar sem digitar nada
    // apagaria o quadro.
    expect(nomeConfere("", "Campanhas")).toBe(false);
    expect(nomeConfere("   ", "Campanhas")).toBe(false);
  });

  it("⚠️ maiúscula IMPORTA", () => {
    // A confirmação existe para obrigar a pessoa a LER o nome do quadro que
    // está prestes a apagar. Aceitar "campanhas" afrouxa justamente o passo
    // que faz ela olhar — e é a mesma regra do nome único da fatia 9.
    expect(nomeConfere("campanhas", "Campanhas")).toBe(false);
  });

  it("espaço nas pontas não atrapalha", () => {
    // O backend grava com `strip()`; um espaço colado não pode virar recusa
    // que a pessoa não consegue ver na tela.
    expect(nomeConfere("  Campanhas  ", "Campanhas")).toBe(true);
  });

  it("nome parecido não confere", () => {
    expect(nomeConfere("Campanha", "Campanhas")).toBe(false);
    expect(nomeConfere("Campanhas 2", "Campanhas")).toBe(false);
  });
});

describe("opcoesDoSeletor -- afordância de apagar", () => {
  it("⚠️ a LENTE nunca oferece apagar, nem para quem gere", () => {
    // Não há registro para apagar, e botão que não funciona é botão em que
    // alguém clica (ADR 0034 item 2).
    const opcoes = opcoesDoSeletor(QUADROS, SEO, true);
    expect(opcoes[0].id).toBeNull();
    expect(opcoes[0].podeApagar).toBe(false);
  });

  it("⚠️ o QUADRO GERAL não aparece na lista, então não há o que apagar", () => {
    // Ele é onde nasce toda tarefa de topo; o backend recusa com
    // `quadro_padrao_nao_apagavel`, e a tela nem chega a oferecer.
    const ids = opcoesDoSeletor(QUADROS, SEO, true).map((o) => o.id);
    expect(ids).not.toContain("b-geral");
  });

  it("sem permissão, quadro avulso não oferece apagar", () => {
    const opcoes = opcoesDoSeletor(QUADROS, SEO, false);
    expect(opcoes.every((o) => !o.podeApagar)).toBe(true);
  });
});

describe("resolverQuadroPedido -- a queda deixou de ser muda (fatia 11)", () => {
  // ⚠️ ATE A FATIA 7 A QUEDA MUDA ERA A DECISAO CERTA, e o docstring do
  // `quadroPedidoNaUrl` explicava: link velho ou id na mao nao merecem erro na
  // cara de quem só abriu a tela. A fatia 7 criou um caso novo -- uma pessoa
  // apaga o quadro que a outra tem aberto -- e em 18/08 ele deixou de ser
  // hipotético: existe quadro avulso em produção, e um já foi apagado.
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
    // ⚠️ É A LINHA MAIS IMPORTANTE DA FUNÇÃO. `null` é "carregando", e avisar
    // aqui poria "este quadro não está aqui" na tela de TODO carregamento, por
    // um instante, antes de o quadro aparecer normalmente. O aviso piscaria
    // para quem não tem problema nenhum.
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
    // Tem conserto: a pessoa está na página errada, e não diante de algo que
    // sumiu. Acontece com link colado entre páginas de times diferentes.
    expect(resolverQuadroPedido("b-crm", QUADROS, SEO)).toEqual({
      id: null,
      motivo: "outro-time",
    });
  });

  it("⚠️ pedir o Quadro geral não é erro -- é pedir onde a pessoa já está", () => {
    // Ele nunca entra no seletor (`opcoesDoSeletor` filtra `!q.is_default`)
    // porque quem o representa nesta tela é a LENTE.
    expect(resolverQuadroPedido("b-geral", QUADROS, SEO)).toEqual({
      id: null,
      motivo: "e-o-quadro-geral",
    });
  });

  it("⚠️ o `quadroPedidoNaUrl` continua valendo, e delega", () => {
    // Os testes antigos dele não mudaram nesta fatia -- ele virou uma casca.
    // Se alguém reimplementar o corpo dele em vez de delegar, as duas versões
    // divergem no primeiro ajuste, que é o defeito que esta fatia não pode
    // introduzir.
    for (const id of ["b-pauta", "b-morto", "b-crm", "b-geral", null]) {
      expect(quadroPedidoNaUrl(id, QUADROS, SEO)).toBe(
        resolverQuadroPedido(id, QUADROS, SEO).id
      );
    }
  });

  it("todo motivo tem texto, e nenhum texto sobra", () => {
    // ⚠️ Motivo sem texto seria `undefined` na tela -- a caixa apareceria
    // vazia, que é pior que não aparecer.
    const motivos = ["fora-de-alcance", "outro-time", "e-o-quadro-geral"];
    expect(Object.keys(TEXTO_DA_QUEDA).sort()).toEqual([...motivos].sort());
    for (const m of motivos) {
      expect(TEXTO_DA_QUEDA[m as keyof typeof TEXTO_DA_QUEDA].length).toBeGreaterThan(10);
    }
  });
});

describe("opcoesDoSeletorDaRaiz -- a tela do Quadro geral (fatia 5c)", () => {
  const RAIZ = "raiz";
  const QUADROS = [
    { id: "b-geral", name: "Quadro geral", team_id: RAIZ, is_default: true, colunas: [] },
    { id: "b-camp", name: "Campanhas 2027", team_id: RAIZ, is_default: false, colunas: [] },
    { id: "b-pauta", name: "Pauta", team_id: SEO, is_default: false, colunas: [] },
  ];

  it("⚠️ o QUADRO GERAL É A PRIMEIRA OPÇÃO, pelo nome dele", () => {
    // ⚠️ NÃO É O `opcoesDoSeletor` COM OUTRO `teamId`. Lá o primeiro item é a
    // LENTE, e o geral fica FORA (`!q.is_default`) porque ela já o representa.
    // Na raiz não há lente: o que a lente espelha É o geral, e na tela dele a
    // coisa é ela mesma.
    const o = opcoesDoSeletorDaRaiz(QUADROS, RAIZ, true);
    expect(o[0].nome).toBe("Quadro geral");
    // ⚠️ E com id de VERDADE -- `null` é a lente, e reaproveitá-lo aqui faria
    // a tela do geral se comportar como espelho de si mesma.
    expect(o[0].id).toBe("b-geral");
  });

  it("⚠️ o Quadro geral NUNCA pode ser apagado, nem para quem gere", () => {
    // `quadro_padrao_nao_apagavel` no backend; ADR 0034 item 2 na tela --
    // ausente, e não desabilitado.
    expect(opcoesDoSeletorDaRaiz(QUADROS, RAIZ, true)[0].podeApagar).toBe(false);
  });

  it("mas PODE ser renomeado -- e até a 5c isso não tinha tela", () => {
    // `board_service.py` diz "O QUADRO GERAL PODE SER RENOMEADO", e o seletor
    // do subtime nunca o listou.
    expect(opcoesDoSeletorDaRaiz(QUADROS, RAIZ, true)[0].podeRenomear).toBe(true);
    expect(opcoesDoSeletorDaRaiz(QUADROS, RAIZ, false)[0].podeRenomear).toBe(false);
  });

  it("os avulsos DA RAIZ entram depois, em ordem de nome", () => {
    const o = opcoesDoSeletorDaRaiz(QUADROS, RAIZ, true);
    expect(o.map((x) => x.nome)).toEqual(["Quadro geral", "Campanhas 2027"]);
  });

  it("⚠️ quadro de OUTRO time não entra", () => {
    // Sem este filtro, a tela do geral listaria o quadro de um subtime, e
    // criar tarefa ali a mandaria para um lugar que ninguém da raiz vê.
    const nomes = opcoesDoSeletorDaRaiz(QUADROS, RAIZ, true).map((x) => x.nome);
    expect(nomes).not.toContain("Pauta");
  });

  it("sem o geral na lista, não inventa uma opção", () => {
    // ⚠️ Acontece se o `listBoards` falhar e cair em `[]`. Melhor uma lista
    // curta que uma opção que não existe.
    const o = opcoesDoSeletorDaRaiz([QUADROS[1]], RAIZ, true);
    expect(o.map((x) => x.nome)).toEqual(["Campanhas 2027"]);
  });
});
