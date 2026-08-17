/**
 * `lib/rascunhoDeColunas` (Spec 036, fatia 6c-1).
 *
 * ⚠️ ESTE ARQUIVO É O GUARDIÃO DA TELA DE EDIÇÃO INTEIRA, e a tela não aparece
 * nele. O arraste de cabeçalho é `onDragEnd` e não roda em jsdom -- o produto
 * já tem dois assim. Toda regra de "o que a edição virou" mora aqui de
 * propósito; o componente só desenha e chama.
 *
 * ⚠️ E O QUE ESTÁ EM JOGO NÃO É COSMÉTICO: o resultado destas funções vira o
 * corpo de um `PUT` que apaga colunas e move tarefas de outras pessoas, numa
 * transação só, sem desfazer.
 */

import { describe, expect, it } from "vitest";

import type { Coluna } from "@/lib/coluna";
import {
  comColunaNova,
  comMarcacao,
  comOrdem,
  comRenome,
  linhasDeEdicao,
  marcadasParaApagar,
  paraLote,
  destinosDoRascunho,
  rascunhoInicial,
  temPendencias,
  totalPrevisto,
} from "@/lib/rascunhoDeColunas";

function col(
  id: string,
  name: string,
  semantic: Coluna["semantic"],
  alvo = false,
): Coluna {
  return {
    id,
    name,
    color: "#000",
    position: 0,
    semantic,
    notify_deadline: true,
    is_default_target: alvo,
  };
}

/** As quatro de um quadro avulso recém-criado: todas alvo da sua semântica. */
const QUADRO: Coluna[] = [
  col("c1", "Backlog", "OPEN", true),
  col("c2", "Em Andamento", "IN_PROGRESS", true),
  col("c3", "Concluído", "DONE", true),
  col("c4", "Cancelado", "CANCELLED", true),
];

const refs = (r: { ordem: readonly string[] }) => [...r.ordem];

describe("rascunhoInicial e temPendencias", () => {
  it("abrir o modo e não mexer não é pendência", () => {
    const r = rascunhoInicial(QUADRO);
    expect(refs(r)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(temPendencias(r, QUADRO)).toBe(false);
  });

  it("⚠️ cada tipo de mexida conta como pendência", () => {
    // ⚠️ É O QUE DECIDE SE SAIR DO MODO AVISA. Faltando qualquer um destes, a
    // pessoa fecha a edição e perde o trabalho em silêncio -- e a coluna nova
    // some sem explicação, porque nunca chegou a existir no servidor.
    const r = rascunhoInicial(QUADRO);
    expect(temPendencias(comRenome(r, "c1", "A fazer"), QUADRO)).toBe(true);
    expect(temPendencias(comMarcacao(r, "c4"), QUADRO)).toBe(true);
    expect(temPendencias(comColunaNova(r, "Ideias", "OPEN"), QUADRO)).toBe(true);
    expect(temPendencias(comOrdem(r, "c1", 2)!, QUADRO)).toBe(true);
  });
});

describe("comOrdem", () => {
  it("move e devolve novo rascunho", () => {
    expect(refs(comOrdem(rascunhoInicial(QUADRO), "c4", 0)!)).toEqual([
      "c4",
      "c1",
      "c2",
      "c3",
    ]);
  });

  it("⚠️ devolve null quando nada muda, e grampeia fora da faixa", () => {
    // ⚠️ Sem o `null`, a seta na ponta viraria pendência -- e a pessoa
    // receberia "há alterações não salvas" ao sair, sobre nada.
    const r = rascunhoInicial(QUADRO);
    expect(comOrdem(r, "c2", 1)).toBeNull();
    expect(comOrdem(r, "sumiu", 0)).toBeNull();
    expect(refs(comOrdem(r, "c1", 99)!)).toEqual(["c2", "c3", "c4", "c1"]);
  });

  it("não muta o rascunho recebido", () => {
    const r = rascunhoInicial(QUADRO);
    comOrdem(r, "c1", 3);
    expect(refs(r)).toEqual(["c1", "c2", "c3", "c4"]);
  });
});

describe("comColunaNova", () => {
  it("nasce no fim, com apelido tmp:", () => {
    const r = comColunaNova(rascunhoInicial(QUADRO), "Ideias", "OPEN");
    expect(refs(r)).toEqual(["c1", "c2", "c3", "c4", "tmp:1"]);
    expect(r.novas).toEqual([
      { ref: "tmp:1", name: "Ideias", semantic: "OPEN" },
    ]);
  });

  it("⚠️ o apelido NUNCA é reaproveitado", () => {
    // Criar, remover, criar de novo tem de dar `tmp:2`. Se recuasse, um
    // `destino` apontando para `tmp:1` passaria a significar OUTRA coluna sem
    // nada mudar na tela -- e as tarefas iriam para o lugar errado.
    let r = comColunaNova(rascunhoInicial(QUADRO), "Ideias", "OPEN");
    r = comMarcacao(r, "tmp:1");
    r = comColunaNova(r, "Outra", "OPEN");
    expect(r.novas.map((n) => n.ref)).toEqual(["tmp:2"]);
    expect(refs(r)).toEqual(["c1", "c2", "c3", "c4", "tmp:2"]);
  });
});

describe("comMarcacao", () => {
  it("marca e desmarca coluna que existe", () => {
    const marcado = comMarcacao(rascunhoInicial(QUADRO), "c4");
    expect(marcado.apagadas).toEqual(["c4"]);
    expect(comMarcacao(marcado, "c4").apagadas).toEqual([]);
  });

  it("⚠️ coluna NOVA é removida, e não marcada", () => {
    // ⚠️ Marcá-la produziria um lote pedindo para apagar um id que ele mesmo
    // acabou de criar -- e o backend recusaria, com razão.
    let r = comColunaNova(rascunhoInicial(QUADRO), "Ideias", "OPEN");
    r = comMarcacao(r, "tmp:1");
    expect(r.novas).toEqual([]);
    expect(r.apagadas).toEqual([]);
    expect(refs(r)).toEqual(["c1", "c2", "c3", "c4"]);
  });
});

describe("comRenome", () => {
  it("coluna que existe entra em `nomes`", () => {
    const r = comRenome(rascunhoInicial(QUADRO), "c1", "A fazer");
    expect(r.nomes).toEqual({ c1: "A fazer" });
  });

  it("⚠️ coluna NOVA guarda o nome nela, e não em `nomes`", () => {
    // ⚠️ Nos dois, o lote diria duas coisas sobre a mesma linha -- `criar` com
    // um nome e `renomear` com outro --, e a ordem entre as etapas viraria
    // regra invisível. O backend nem aceita: `renomear` só recebe UUID.
    let r = comColunaNova(rascunhoInicial(QUADRO), "Ideias", "OPEN");
    r = comRenome(r, "tmp:1", "Entregue");
    expect(r.nomes).toEqual({});
    expect(r.novas[0].name).toBe("Entregue");
  });
});

describe("linhasDeEdicao", () => {
  it("desenha na ordem do rascunho, com o nome novo", () => {
    let r = rascunhoInicial(QUADRO);
    r = comRenome(r, "c1", "A fazer");
    r = comOrdem(r, "c4", 0)!;
    expect(linhasDeEdicao(r, QUADRO).map((l) => l.nome)).toEqual([
      "Cancelado",
      "A fazer",
      "Em Andamento",
      "Concluído",
    ]);
  });

  it("⚠️ a marcada CONTINUA na lista, riscada", () => {
    // Tirá-la faria a coluna sumir no clique -- e o modelo é de lote: enquanto
    // não concluir, nada aconteceu, e a pessoa precisa poder desmarcar.
    const r = comMarcacao(rascunhoInicial(QUADRO), "c4");
    const linhas = linhasDeEdicao(r, QUADRO);
    expect(linhas).toHaveLength(4);
    expect(linhas.find((l) => l.ref === "c4")!.apagada).toBe(true);
  });

  it("⚠️ o selo de alvo sai do dado, e não da ordem", () => {
    // ADR 0030: o destino da cascata é `is_default_target`, e NÃO a primeira
    // pela ordem. Arrastar não pode mudar quem é o alvo.
    const r = comOrdem(rascunhoInicial(QUADRO), "c3", 0)!;
    const linhas = linhasDeEdicao(r, QUADRO);
    expect(linhas.filter((l) => l.alvo).map((l) => l.ref).sort()).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
    ]);
  });

  it("⚠️ criar uma segunda DONE NÃO libera apagar a atual", () => {
    // ⚠️ É A CONSEQUÊNCIA MAIS CONTRAINTUITIVA DESTA SPEC, e é aqui que ela
    // aparece para quem usa. Coluna criada por gente nasce com
    // `is_default_target: false`, e o que tem de sobrar é um ALVO. Sem esta
    // conta, a tela ofereceria o "×" e o backend recusaria depois do clique.
    let r = rascunhoInicial(QUADRO);
    r = comColunaNova(r, "Entregue", "DONE");
    const concluido = linhasDeEdicao(r, QUADRO).find((l) => l.ref === "c3")!;
    expect(concluido.impedimento).not.toBeNull();
  });

  it("com duas colunas ALVO da mesma semântica, apagar uma libera", () => {
    const comDuasDone = [...QUADRO, col("c5", "Entregue", "DONE", true)];
    const linhas = linhasDeEdicao(rascunhoInicial(comDuasDone), comDuasDone);
    expect(linhas.find((l) => l.ref === "c3")!.impedimento).toBeNull();
  });

  it("a linha JÁ marcada não carrega impedimento", () => {
    const r = comMarcacao(rascunhoInicial(QUADRO), "c1");
    expect(linhasDeEdicao(r, QUADRO).find((l) => l.ref === "c1")!.impedimento)
      .toBeNull();
  });
});

describe("paraLote", () => {
  it("⚠️ o caso que justifica o lote: trocar uma coluna por outra", () => {
    // Criar "Entregue" e mandar as tarefas de "Concluído" para ela, tudo antes
    // de existir id. Sem `tmp:`, isto seria duas idas em duas telas.
    let r = rascunhoInicial(QUADRO);
    r = comColunaNova(r, "Entregue", "DONE");
    r = comMarcacao(r, "c3");
    const lote = paraLote(r, QUADRO, { c3: "tmp:1" });

    expect(lote.criar).toEqual([
      { tmp: "1", name: "Entregue", semantic: "DONE" },
    ]);
    expect(lote.apagar).toEqual([{ id: "c3", destino: "tmp:1" }]);
    // ⚠️ O `tmp:` SAI DO `criar` E FICA NO `destino`: o backend monta o mapa na
    // etapa de criação e resolve na de apagar.
    expect(lote.ordem).toEqual(["c1", "c2", "c4", "tmp:1"]);
  });

  it("⚠️ ordem vazia quando a ordem não mudou", () => {
    // O backend lê vazio como "não mexer". Mandar a lista igual funcionaria,
    // mas transformaria toda edição num pedido de reordenação, e o log do
    // servidor deixaria de distinguir quem arrastou de quem só renomeou.
    const r = comRenome(rascunhoInicial(QUADRO), "c1", "A fazer");
    const lote = paraLote(r, QUADRO);
    expect(lote.ordem).toEqual([]);
    expect(lote.renomear).toEqual([{ id: "c1", name: "A fazer" }]);
  });

  it("⚠️ apagar uma coluna sozinho NÃO conta como mudança de ordem", () => {
    // A lista final é a original menos a apagada, na mesma sequência. Mandar
    // `ordem` aqui faria o backend rodar a etapa 4 à toa.
    const r = comMarcacao(rascunhoInicial(QUADRO), "c4");
    expect(paraLote(r, QUADRO).ordem).toEqual([]);
  });

  it("⚠️ não renomeia coluna que o mesmo lote apaga", () => {
    // Renomear uma linha que a etapa seguinte remove é trabalho e uma entrada
    // de log de algo que, para quem usa, não aconteceu.
    let r = comRenome(rascunhoInicial(QUADRO), "c4", "Descartado");
    r = comMarcacao(r, "c4");
    expect(paraLote(r, QUADRO).renomear).toEqual([]);
  });

  it("destino ausente vira null -- a coluna está vazia", () => {
    const r = comMarcacao(rascunhoInicial(QUADRO), "c4");
    expect(paraLote(r, QUADRO).apagar).toEqual([{ id: "c4", destino: null }]);
  });

  it("lote de quem não mexeu em nada é inteiramente vazio", () => {
    expect(paraLote(rascunhoInicial(QUADRO), QUADRO)).toEqual({
      criar: [],
      renomear: [],
      apagar: [],
      ordem: [],
    });
  });
});

describe("destinosDoRascunho", () => {
  it("⚠️ inclui a coluna criada no rascunho", () => {
    // ⚠️ E A DIFERENCA QUE JUSTIFICA ESTA FUNCAO. O `destinosPara` antigo
    // devolvia so as colunas do servidor -- e sem as `tmp:` nao da para apagar
    // "Aprovacao" mandando as tarefas para a "Entregue" que voce acabou de
    // criar, que e a razao de ser do lote inteiro.
    const r = comColunaNova(rascunhoInicial(QUADRO), "Entregue", "DONE");
    expect(destinosDoRascunho(r, QUADRO).map((d) => d.ref)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
      "tmp:1",
    ]);
  });

  it("⚠️ usa o nome do RASCUNHO, e nao o do servidor", () => {
    // Renomear e, no mesmo lote, apagar outra coluna mandando tarefas para la
    // tem de mostrar o nome novo -- senao a revisao descreve um quadro que ja
    // nao e o que a pessoa esta vendo.
    const r = comRenome(rascunhoInicial(QUADRO), "c3", "Entregue");
    expect(
      destinosDoRascunho(r, QUADRO).find((d) => d.ref === "c3")!.nome,
    ).toBe("Entregue");
  });

  it("segue a ordem do rascunho, e nao a do servidor", () => {
    const r = comOrdem(rascunhoInicial(QUADRO), "c4", 0)!;
    expect(destinosDoRascunho(r, QUADRO)[0].ref).toBe("c4");
  });

  it("⚠️ NAO filtra as marcadas -- quem faz isso e a revisao", () => {
    // Ela precisa saber quais sao para nao oferecer uma como destino da outra:
    // a ordem das exclusoes decidiria o resultado, e ela vem da ordem dos
    // cliques.
    const r = comMarcacao(rascunhoInicial(QUADRO), "c4");
    expect(destinosDoRascunho(r, QUADRO).map((d) => d.ref)).toContain("c4");
  });
});

describe("totalPrevisto", () => {
  it("soma as contagens das marcadas", () => {
    let r = comMarcacao(rascunhoInicial(QUADRO), "c2");
    r = comMarcacao(r, "c4");
    expect(totalPrevisto(r, { c1: 99, c2: 12, c4: 3 })).toBe(15);
  });

  it("⚠️ coluna sem contagem conhecida conta ZERO, e nao estoura", () => {
    // A busca das contagens pode falhar; somar `undefined` daria `NaN`, e o
    // aviso de divergencia sairia comparando "NaN" com o numero do servidor.
    const r = comMarcacao(rascunhoInicial(QUADRO), "c2");
    expect(totalPrevisto(r, {})).toBe(0);
  });
});

describe("marcadasParaApagar", () => {
  it("devolve as colunas inteiras, para a revisão perguntar o destino", () => {
    let r = comMarcacao(rascunhoInicial(QUADRO), "c4");
    r = comMarcacao(r, "c2");
    expect(marcadasParaApagar(r, QUADRO).map((c) => c.name)).toEqual([
      "Em Andamento",
      "Cancelado",
    ]);
  });

  it("coluna nova removida não entra na revisão", () => {
    let r = comColunaNova(rascunhoInicial(QUADRO), "Ideias", "OPEN");
    r = comMarcacao(r, "tmp:1");
    expect(marcadasParaApagar(r, QUADRO)).toEqual([]);
  });
});
