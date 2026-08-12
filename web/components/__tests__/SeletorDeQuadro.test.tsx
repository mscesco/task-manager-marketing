/**
 * Spec 036, fatia 5b-6 -- o SeletorDeQuadro, montado.
 *
 * ⚠️ A REGRA NAO SE TESTA AQUI. Quem lista, ordena, filtra e diz o que tem
 * afordancia e `lib/seletorDeQuadro.ts`, com 22 testes proprios. Este arquivo
 * pergunta outra coisa: **o componente LE aquelas respostas, e o que ele manda
 * para a API bate com o que a pessoa digitou?**
 *
 * ⚠️ E ISSO NAO E FORMALIDADE NESTE PROJETO. A fatia 5b-5a entregou
 * `colunaEquivalente` e `rotuloDeColuna` verdes e sem leitor nenhum, e quando
 * a tela finalmente as chamou a assinatura nao servia -- precisou ser refeita.
 * Modulo puro verde nao prova que alguem o usa direito.
 *
 * SABOTAGENS (medidas):
 *   R. Desenhar "Renomear" para toda opcao, ignorando `podeRenomear`.
 *   S. `createBoard` mandando o nome CRU, sem `nomeDeQuadroValido`.
 *   T. Nao chamar `onSelecionar` depois de criar.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SeletorDeQuadro from "@/components/SeletorDeQuadro";
import type { Quadro } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return { ...real, createBoard: vi.fn(), renameBoard: vi.fn() };
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
    ...over,
  };
  render(<SeletorDeQuadro {...props} />);
  return props;
}

describe("SeletorDeQuadro -- o que ele desenha", () => {
  it("mostra a lente e os quadros DAQUELE time", () => {
    montar();
    expect(screen.getByRole("tab", { name: /Lente do time/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Pauta editorial/ })).toBeTruthy();
    // ⚠️ Do CRM e o padrao da raiz nao entram -- a regra e do modulo puro, e
    // esta linha prova que o componente NAO monta a lista por conta propria.
    expect(screen.queryByRole("tab", { name: /Automações/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Quadro geral/ })).toBeNull();
  });

  it("⚠️ a LENTE nao tem botao de renomear -- nem com podeGerir", () => {
    // ADR 0034 item 2: ausente, e nao desabilitada.
    montar({ podeGerir: true });
    expect(screen.queryByLabelText("Renomear Lente do time")).toBeNull();
    expect(screen.getByLabelText("Renomear Pauta editorial")).toBeTruthy();
  });

  it("sem podeGerir, nem renomear nem novo quadro aparecem", () => {
    montar({ podeGerir: false });
    expect(screen.queryByLabelText("Renomear Pauta editorial")).toBeNull();
    expect(screen.queryByText("+ Novo quadro")).toBeNull();
    // ...mas os quadros continuam VISIVEIS: some a afordancia de editar, e
    // nao o conteudo.
    expect(screen.getByRole("tab", { name: /Pauta editorial/ })).toBeTruthy();
  });

  it("clicar num quadro avisa o pai com o id", () => {
    const props = montar();
    fireEvent.click(screen.getByRole("tab", { name: /Pauta editorial/ }));
    expect(props.onSelecionar).toHaveBeenCalledWith("b-pauta");
  });

  it("⚠️ clicar na lente avisa com null, e nao com um id falso", () => {
    // A lente nao existe como registro. Um id falso a faria parecer um quadro
    // para qualquer codigo que compare ids.
    const props = montar({ selecionado: "b-pauta" });
    fireEvent.click(screen.getByRole("tab", { name: /Lente do time/ }));
    expect(props.onSelecionar).toHaveBeenCalledWith(null);
  });
});

describe("SeletorDeQuadro -- criar", () => {
  it("manda o nome APARADO para a API", async () => {
    vi.mocked(api.createBoard).mockResolvedValue(
      quadro({ id: "b-novo", name: "Campanhas" })
    );
    montar();

    fireEvent.click(screen.getByText("+ Novo quadro"));
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

  it("⚠️ nome so com espaco NAO chega na API", async () => {
    // ⚠️ O backend tambem recusa, com 422. Mas gastar a requisicao para uma
    // regra que a tela ja conhece transforma um aviso imediato num erro
    // depois de digitar.
    montar();
    fireEvent.click(screen.getByText("+ Novo quadro"));
    fireEvent.change(screen.getByLabelText("Nome do novo quadro"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByText("Criar"));

    await screen.findByRole("alert");
    expect(vi.mocked(api.createBoard)).not.toHaveBeenCalled();
  });

  it("⚠️ depois de criar, o quadro NOVO passa a ser o selecionado", async () => {
    // Criar e continuar na lente deixaria a pessoa sem sinal de que algo
    // aconteceu -- o quadro novo ficaria atras de mais um clique.
    vi.mocked(api.createBoard).mockResolvedValue(
      quadro({ id: "b-novo", name: "Campanhas" })
    );
    const props = montar();

    fireEvent.click(screen.getByText("+ Novo quadro"));
    fireEvent.change(screen.getByLabelText("Nome do novo quadro"), {
      target: { value: "Campanhas" },
    });
    fireEvent.click(screen.getByText("Criar"));

    await waitFor(() =>
      expect(props.onSelecionar).toHaveBeenCalledWith("b-novo")
    );
    expect(props.onMudou).toHaveBeenCalled();
  });

  it("erro da API aparece na tela, com a mensagem do backend", async () => {
    vi.mocked(api.createBoard).mockRejectedValue(
      Object.assign(new Error(), { message: "Sem permissão neste time." })
    );
    montar();

    fireEvent.click(screen.getByText("+ Novo quadro"));
    fireEvent.change(screen.getByLabelText("Nome do novo quadro"), {
      target: { value: "Campanhas" },
    });
    fireEvent.click(screen.getByText("Criar"));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Sem permissão neste time."
    );
  });
});

describe("SeletorDeQuadro -- renomear", () => {
  it("abre com o nome ATUAL preenchido", () => {
    montar();
    fireEvent.click(screen.getByLabelText("Renomear Pauta editorial"));
    expect(
      (screen.getByLabelText("Novo nome do quadro") as HTMLInputElement).value
    ).toBe("Pauta editorial");
  });

  it("manda o id do quadro e o nome novo", async () => {
    vi.mocked(api.renameBoard).mockResolvedValue(
      quadro({ id: "b-pauta", name: "Pauta 2026" })
    );
    const props = montar();

    fireEvent.click(screen.getByLabelText("Renomear Pauta editorial"));
    fireEvent.change(screen.getByLabelText("Novo nome do quadro"), {
      target: { value: "Pauta 2026" },
    });
    fireEvent.click(screen.getByText("Salvar"));

    await waitFor(() =>
      expect(vi.mocked(api.renameBoard)).toHaveBeenCalledWith(
        "b-pauta",
        "Pauta 2026"
      )
    );
    expect(props.onMudou).toHaveBeenCalled();
    // ⚠️ Renomear NAO troca a selecao -- a pessoa continua onde estava.
    expect(props.onSelecionar).not.toHaveBeenCalled();
  });

  it("Escape fecha sem mandar nada", () => {
    montar();
    fireEvent.click(screen.getByLabelText("Renomear Pauta editorial"));
    fireEvent.keyDown(screen.getByLabelText("Novo nome do quadro"), {
      key: "Escape",
    });
    expect(screen.queryByLabelText("Novo nome do quadro")).toBeNull();
    expect(vi.mocked(api.renameBoard)).not.toHaveBeenCalled();
  });
});
