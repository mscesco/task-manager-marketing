/**
 * Spec 036 -- o SeletorDeQuadro, montado.
 * ⚠️ REESCRITO NA FATIA 10 (18/08): ele virou DROPDOWN, e RENOMEAR/APAGAR
 * saíram daqui para o `AcoesDoQuadro` (barra do modo de edição).
 *
 * ⚠️ OS TESTES DE RENOMEAR E APAGAR NÃO FORAM APAGADOS -- foram MOVIDOS para
 * `AcoesDoQuadro.test.tsx`, com as mesmas sabotagens. Apagar guardião ao mover
 * código é como a fatia 5b-5a entregou `colunaEquivalente` sem leitor: verde e
 * sem prova de nada.
 *
 * ⚠️ A REGRA NAO SE TESTA AQUI. Quem lista, ordena, filtra e diz o que tem
 * afordancia e `lib/seletorDeQuadro.ts`, com testes proprios que esta fatia
 * NAO tocou -- ele nao sabe como a tela desenha. Este arquivo pergunta outra
 * coisa: **o componente LE aquelas respostas, e o que ele manda para a API bate
 * com o que a pessoa digitou?**
 *
 * ⚠️ E ISSO NAO E FORMALIDADE NESTE PROJETO. A fatia 5b-5a entregou
 * `colunaEquivalente` e `rotuloDeColuna` verdes e sem leitor nenhum, e quando
 * a tela finalmente as chamou a assinatura nao servia -- precisou ser refeita.
 * Modulo puro verde nao prova que alguem o usa direito.
 *
 * SABOTAGENS (medidas):
 *   S. `createBoard` mandando o nome CRU, sem `nomeDeQuadroValido`.
 *   T. Nao chamar `onSelecionar` depois de criar.
 *   U. O dropdown nao fechar ao clicar fora (regressao do painel de filtros).
 *   V. O dropdown listar quadro de OUTRO time, ou o padrao da raiz.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SeletorDeQuadro from "@/components/SeletorDeQuadro";
import type { Quadro } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    createBoard: vi.fn(),
  };
});

const api = await import("@/lib/api");

const SEO = "team-seo";
const CRM = "team-crm";

function quadro(over: Partial<Quadro> & { id: string; name: string }): Quadro {
  return { team_id: SEO, is_default: false, colunas: [], ...over };
}

const QUADROS: Quadro[] = [
  quadro({ id: "b-geral", name: "Quadro geral", team_id: "raiz", is_default: true }),
  quadro({ id: "b-pauta", name: "Pauta editorial" }),
  quadro({ id: "b-crm", name: "Automações", team_id: CRM }),
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

function montar(over: Partial<Parameters<typeof SeletorDeQuadro>[0]> = {}) {
  const props = {
    teamId: SEO,
    quadros: QUADROS,
    selecionado: null,
    podeGerir: true,
    onSelecionar: vi.fn(),
    onMudou: vi.fn(),
    // ⚠️ O DEFAULT DO HELPER E `false` -- a tela de SUBTIME, que e o assunto da
    // maioria destes testes. A prop virou OBRIGATORIA em 11/09 (ver o bloco
    // dela): ela era opcional, e a rota `/quadro/[teamId]` nao a passava, o que
    // punha "Lente do time" no cabecalho de uma raiz. O default aqui e do
    // ARREIO, e nao do componente -- quem desenha tem de dizer.
    daRaiz: false,
    ...over,
  };
  render(<SeletorDeQuadro {...props} />);
  return props;
}

/** Abre o dropdown. O gatilho é o TÍTULO -- ver `aria-label` do botão. */
function abrir() {
  fireEvent.click(screen.getByRole("button", { name: /Trocar de quadro/ }));
}

describe("SeletorDeQuadro -- o gatilho é o título", () => {
  it("⚠️ FECHADO, mostra só o nome do escolhido -- e nenhuma opção", () => {
    // ⚠️ ESTE E O GANHO DA FATIA 10, e o teste que o prende. A versao anterior
    // desenhava um botao por quadro MAIS "Renomear" e "Apagar" ao lado de cada
    // um: `1 + 2N + 1` elementos sempre visiveis. Se alguem "consertar"
    // voltando a lista para a linha, esta linha cai.
    montar();
    expect(screen.getByRole("button", { name: /Trocar de quadro/ })).toBeTruthy();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("o nome no gatilho é o do quadro ESCOLHIDO, e não o da lente", () => {
    montar({ selecionado: "b-pauta" });
    expect(
      screen.getByRole("button", { name: /Trocar de quadro/ }).textContent
    ).toContain("Pauta editorial");
  });

  it("⚠️ o gatilho NÃO fixa tamanho de fonte -- ele herda do `<h1>`", () => {
    // ⚠️ ESTE TESTE EXISTE POR UM DEFEITO DE OITO DIAS, achado na tela pela
    // Camila em 22/08 ("as coisas do cabeçalho estão meio tortas comparadas
    // com o nome do quadro").
    //
    // O `Board` desenha `<h1 style={{ fontSize: 26 }}>{title}</h1>` e este
    // botão É o `title`. Ele trazia `font: "inherit"` seguido de
    // `fontSize: 19` -- então o título do quadro continuou 19px enquanto a F1
    // acreditava tê-lo levado a 26, e saía 1,7px fora do eixo dos vizinhos na
    // linha do cabeçalho. Medido no navegador: `getComputedStyle` devolvia
    // 19px dentro de um h1 de 26.
    //
    // ⚠️ TERCEIRA VEZ DO MESMO ATALHO no projeto -- ele já tinha matado o
    // `fontSize` da pílula de datas (F7). `font` redefine tamanho, peso e
    // altura de linha junto com a família.
    //
    // ⚠️ O QUE ESTE TESTE PRENDE É POUCO, e é honesto dizer: jsdom não tem
    // layout, então ele não mede posição nenhuma. Ele prende só que o estilo
    // inline não CRAVA um tamanho -- que é exatamente o erro que aconteceu
    // duas vezes. O alinhamento em si continua ⚪ sem verificação.
    montar();
    const gatilho = screen.getByRole("button", { name: /Trocar de quadro/ });
    expect(gatilho.style.fontSize).toBe("inherit");
    expect(gatilho.style.fontWeight).toBe("inherit");
    // ⚠️ NADA de tamanho absoluto: era o `19px` que prendia o título. Não dá
    // para checar o atalho `font` diretamente -- o CSSOM o remonta a partir
    // dos longhands e devolve "inherit" nos dois casos, então essa asserção
    // não discrimina. O que discrimina é o tamanho não ser px.
    expect(gatilho.style.fontSize).not.toMatch(/px$/);
  });

  it("⚠️ id desconhecido cai na LENTE, e o gatilho diz isso", () => {
    // Mesma regra do `opcaoSelecionada`: o quadro pode ter sido apagado por
    // outra pessoa. O gatilho nao pode ficar mostrando um nome que nao existe.
    montar({ selecionado: "b-que-nao-existe" });
    expect(
      screen.getByRole("button", { name: /Trocar de quadro/ }).textContent
    ).toContain("Lente do time");
  });
});

describe("SeletorDeQuadro -- aberto", () => {
  it("mostra a lente e os quadros DAQUELE time", () => {
    montar();
    abrir();
    expect(screen.getByRole("option", { name: /Lente do time/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Pauta editorial/ })).toBeTruthy();

    // ⚠️ QUAL ESTA ESCOLHIDO PRECISA CHEGAR A QUEM NAO ENXERGA. O unico outro
    // sinal e a COR do item, e cor nao chega a leitor de tela nenhum. Sem esta
    // linha, trocar `aria-selected` por nada nao derruba teste algum.
    expect(
      screen.getByRole("option", { name: /Lente do time/ }).getAttribute("aria-selected")
    ).toBe("true");
    expect(
      screen.getByRole("option", { name: /Pauta editorial/ }).getAttribute("aria-selected")
    ).toBe("false");

    // ⚠️ Do CRM e o padrao da raiz NAO entram -- a regra e do modulo puro, e
    // estas duas linhas provam que o componente NAO monta a lista por conta
    // propria. Sabotagem V.
    expect(screen.queryByRole("option", { name: /Automações/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /Quadro geral/ })).toBeNull();
  });

  it("a lente vem com a descrição que a diferencia de um quadro próprio", () => {
    // ⚠️ E a frase que explica a diferenca entre "espelho do quadro geral" e um
    // registro proprio. Ela ja sumiu uma vez por contraste (medido: 1.68 no
    // tema claro sobre o fundo do item escolhido, contra os 4.5 do AA).
    montar();
    abrir();
    expect(screen.getByText("espelho do quadro geral")).toBeTruthy();
  });

  it("escolher um quadro avisa o pai com o id, e FECHA", () => {
    const props = montar();
    abrir();
    fireEvent.click(screen.getByRole("option", { name: /Pauta editorial/ }));
    expect(props.onSelecionar).toHaveBeenCalledWith("b-pauta");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("⚠️ escolher a lente avisa com null, e não com um id falso", () => {
    // A lente nao existe como registro. Um id falso a faria parecer um quadro
    // para qualquer codigo que compare ids.
    const props = montar({ selecionado: "b-pauta" });
    abrir();
    fireEvent.click(screen.getByRole("option", { name: /Lente do time/ }));
    expect(props.onSelecionar).toHaveBeenCalledWith(null);
  });

  it("⚠️ clicar FORA fecha -- sabotagem U", () => {
    // ⚠️ Mesmo padrao do painel de filtros (`Board.tsx:252`). Sem isto o menu
    // fica aberto por cima das colunas e a pessoa perde o quadro de vista.
    montar();
    abrir();
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("sem podeGerir, o dropdown abre mas NÃO oferece criar", () => {
    montar({ podeGerir: false });
    abrir();
    // ...os quadros continuam VISIVEIS: some a afordancia de criar, e nao o
    // conteudo.
    expect(screen.getByRole("option", { name: /Pauta editorial/ })).toBeTruthy();
    expect(screen.queryByText("+ Novo quadro")).toBeNull();
  });

  it("⚠️ '+ Novo quadro' NÃO é uma opção da lista", () => {
    // ⚠️ Ele nao e escolha de quadro: com `role="option"` um leitor de tela
    // anunciaria "opcao 3 de 3" e a pessoa esperaria trocar de quadro ao
    // clicar. Fica fora da lista, depois do separador.
    montar();
    abrir();
    const opcoes = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opcoes.some((t) => t?.includes("Novo quadro"))).toBe(false);
    expect(screen.getByText("+ Novo quadro")).toBeTruthy();
  });
});

describe("SeletorDeQuadro -- criar", () => {
  function abrirNovo() {
    abrir();
    fireEvent.click(screen.getByText("+ Novo quadro"));
  }

  it("⚠️ abrir o campo FECHA o dropdown", () => {
    // O campo nasce abaixo do gatilho, no lugar do painel. Os dois abertos
    // poriam um input dentro de um menu que fecha ao clicar fora.
    montar();
    abrirNovo();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByLabelText("Nome do novo quadro")).toBeTruthy();
  });

  it("manda o nome APARADO para a API -- sabotagem S", async () => {
    vi.mocked(api.createBoard).mockResolvedValue(
      quadro({ id: "b-novo", name: "Campanhas" })
    );
    montar();
    abrirNovo();

    fireEvent.change(screen.getByLabelText("Nome do novo quadro"), {
      target: { value: "  Campanhas  " },
    });
    fireEvent.click(screen.getByText("Criar"));

    await waitFor(() =>
      expect(vi.mocked(api.createBoard)).toHaveBeenCalledWith({
        name: "Campanhas",
        team_id: SEO,
      })
    );
  });

  it("⚠️ nome só com espaço NÃO chega na API", async () => {
    // ⚠️ O backend tambem recusa, com 422. Mas gastar a requisicao para uma
    // regra que a tela ja conhece transforma um aviso imediato num erro
    // depois de digitar.
    montar();
    abrirNovo();
    fireEvent.change(screen.getByLabelText("Nome do novo quadro"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByText("Criar"));

    await screen.findByRole("alert");
    expect(vi.mocked(api.createBoard)).not.toHaveBeenCalled();
  });

  it("⚠️ depois de criar, o quadro NOVO passa a ser o selecionado -- sabotagem T", async () => {
    // Criar e continuar na lente deixaria a pessoa sem sinal de que algo
    // aconteceu -- o quadro novo ficaria atras de mais um clique.
    vi.mocked(api.createBoard).mockResolvedValue(
      quadro({ id: "b-novo", name: "Campanhas" })
    );
    const props = montar();
    abrirNovo();

    fireEvent.change(screen.getByLabelText("Nome do novo quadro"), {
      target: { value: "Campanhas" },
    });
    fireEvent.click(screen.getByText("Criar"));

    await waitFor(() =>
      expect(props.onSelecionar).toHaveBeenCalledWith("b-novo")
    );
    expect(props.onMudou).toHaveBeenCalled();
  });

  it("Escape fecha o campo sem mandar nada", () => {
    montar();
    abrirNovo();
    fireEvent.keyDown(screen.getByLabelText("Nome do novo quadro"), {
      key: "Escape",
    });
    expect(screen.queryByLabelText("Nome do novo quadro")).toBeNull();
    expect(vi.mocked(api.createBoard)).not.toHaveBeenCalled();
  });

  it("erro da API aparece na tela, com a mensagem do backend", async () => {
    vi.mocked(api.createBoard).mockRejectedValue(
      Object.assign(new Error(), { message: "Sem permissão neste time." })
    );
    montar();
    abrirNovo();

    fireEvent.change(screen.getByLabelText("Nome do novo quadro"), {
      target: { value: "Campanhas" },
    });
    fireEvent.click(screen.getByText("Criar"));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Sem permissão neste time."
    );
  });
});
