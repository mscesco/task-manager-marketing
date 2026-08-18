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
  return {
    ...real,
    createBoard: vi.fn(),
    renameBoard: vi.fn(),
    getBoard: vi.fn(),
    deleteBoard: vi.fn(),
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
    ...over,
  };
  render(<SeletorDeQuadro {...props} />);
  return props;
}

describe("SeletorDeQuadro -- o que ele desenha", () => {
  it("mostra a lente e os quadros DAQUELE time", () => {
    montar();
    // ⚠️ `button`, E NAO `tab` (13/08). O grupo usava `role="tablist"`/`tab`,
    // que promete navegacao por setas e um `tabpanel` do outro lado -- nada
    // disso existia. Virou `role="group"` com `aria-pressed`, que e o que a
    // interacao realmente faz.
    expect(screen.getByRole("button", { name: /^Lente do time/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Pauta editorial/ })).toBeTruthy();

    // ⚠️ QUAL ESTA ESCOLHIDO PRECISA CHEGAR A QUEM NAO ENXERGA. Ate aqui o
    // unico sinal era a COR do botao (`btn-primary` contra `btn-ghost`), e cor
    // nao chega a leitor de tela nenhum. Sem esta linha, trocar `aria-pressed`
    // por nada nao derruba teste algum.
    expect(
      screen.getByRole("button", { name: /^Lente do time/ }).getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: /^Pauta editorial/ }).getAttribute("aria-pressed")
    ).toBe("false");
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
    expect(screen.getByRole("button", { name: /^Pauta editorial/ })).toBeTruthy();
  });

  it("clicar num quadro avisa o pai com o id", () => {
    const props = montar();
    fireEvent.click(screen.getByRole("button", { name: /^Pauta editorial/ }));
    expect(props.onSelecionar).toHaveBeenCalledWith("b-pauta");
  });

  it("⚠️ clicar na lente avisa com null, e nao com um id falso", () => {
    // A lente nao existe como registro. Um id falso a faria parecer um quadro
    // para qualquer codigo que compare ids.
    const props = montar({ selecionado: "b-pauta" });
    fireEvent.click(screen.getByRole("button", { name: /^Lente do time/ }));
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


describe("SeletorDeQuadro -- apagar quadro (fatia 7)", () => {
  // ⚠️ É A OPERAÇÃO MAIS DESTRUTIVA DO PRODUTO, e a única que não pergunta o
  // destino das tarefas. Estes testes são a única coisa que prende a
  // confirmação — a conferência visual não roda a cada commit.

  it("⚠️ a LENTE não tem botão de apagar", () => {
    montar();
    expect(screen.queryByLabelText("Apagar Lente do time")).toBeNull();
  });

  it("sem permissão, nenhum quadro tem botão de apagar", () => {
    montar({ podeGerir: false });
    expect(screen.queryByLabelText(/^Apagar /)).toBeNull();
  });

  it("⚠️ o botão de confirmar fica TRAVADO até o nome bater", async () => {
    // ⚠️ E até a CONTAGEM chegar: confirmar sem saber quantas tarefas vão
    // junto é o que este diálogo existe para impedir.
    vi.mocked(api.getBoard).mockResolvedValue({
      ...QUADROS[1],
      task_count: 12,
    });
    montar();
    fireEvent.click(screen.getByLabelText("Apagar Pauta editorial"));

    const botao = await screen.findByText("Apagar quadro");
    expect((botao as HTMLButtonElement).disabled).toBe(true);

    const campo = screen.getByLabelText(/Digite/);
    fireEvent.change(campo, { target: { value: "pauta editorial" } });
    expect((screen.getByText("Apagar quadro") as HTMLButtonElement).disabled).toBe(
      true
    );

    fireEvent.change(campo, { target: { value: "Pauta editorial" } });
    expect((screen.getByText("Apagar quadro") as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it("⚠️ a contagem aparece ANTES do campo, e diz que arquivadas vão junto", async () => {
    vi.mocked(api.getBoard).mockResolvedValue({
      ...QUADROS[1],
      task_count: 12,
    });
    montar();
    fireEvent.click(screen.getByLabelText("Apagar Pauta editorial"));
    expect(await screen.findByText("12")).toBeTruthy();
    expect(screen.getByText(/arquivadas/)).toBeTruthy();
  });

  it("⚠️ enquanto a contagem não chega, não dá para confirmar", async () => {
    // ⚠️ Um `?? 0` no lugar do travamento faria a tela dizer "nenhuma tarefa"
    // sobre um quadro cheio -- e a pessoa confirmaria com base nisso.
    vi.mocked(api.getBoard).mockReturnValue(new Promise(() => {}));
    montar();
    fireEvent.click(screen.getByLabelText("Apagar Pauta editorial"));
    const campo = await screen.findByLabelText(/Digite/);
    fireEvent.change(campo, { target: { value: "Pauta editorial" } });
    expect((screen.getByText("Apagar quadro") as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(screen.getByText("Contando as tarefas…")).toBeTruthy();
  });

  it("confirma, sai do quadro apagado e manda recarregar", async () => {
    vi.mocked(api.getBoard).mockResolvedValue({
      ...QUADROS[1],
      task_count: 3,
    });
    vi.mocked(api.deleteBoard).mockResolvedValue({ tarefas_apagadas: 3 });
    const props = montar({ selecionado: "b-pauta" });

    fireEvent.click(screen.getByLabelText("Apagar Pauta editorial"));
    const campo = await screen.findByLabelText(/Digite/);
    fireEvent.change(campo, { target: { value: "Pauta editorial" } });
    fireEvent.click(screen.getByText("Apagar quadro"));

    await waitFor(() => expect(api.deleteBoard).toHaveBeenCalledWith("b-pauta"));
    // ⚠️ SAIR DO QUADRO APAGADO É OBRIGATÓRIO. Sem isto a tela continuaria
    // pedindo um `boardId` que a lista não devolve mais -- o "Carregando…"
    // eterno anotado no `Board.tsx`.
    await waitFor(() => expect(props.onSelecionar).toHaveBeenCalledWith(null));
    expect(props.onMudou).toHaveBeenCalled();
  });

  it("⚠️ apagar OUTRO quadro não tira a pessoa do que ela está vendo", async () => {
    const links = quadro({ id: "b-links", name: "Construção de links" });
    vi.mocked(api.getBoard).mockResolvedValue({ ...links, task_count: 0 });
    vi.mocked(api.deleteBoard).mockResolvedValue({ tarefas_apagadas: 0 });
    const props = montar({
      selecionado: "b-pauta",
      quadros: [...QUADROS, links],
    });

    fireEvent.click(screen.getByLabelText("Apagar Construção de links"));
    const campo = await screen.findByLabelText(/Digite/);
    fireEvent.change(campo, { target: { value: "Construção de links" } });
    fireEvent.click(screen.getByText("Apagar quadro"));

    await waitFor(() => expect(api.deleteBoard).toHaveBeenCalled());
    expect(props.onSelecionar).not.toHaveBeenCalled();
  });

  it("⚠️ contagem diferente do apagado AVISA", async () => {
    // Alguém criou tarefa entre a leitura e o clique. Dois números sobre a
    // mesma coisa é pior que um número velho -- mesmo desenho do lote.
    vi.mocked(api.getBoard).mockResolvedValue({
      ...QUADROS[1],
      task_count: 3,
    });
    vi.mocked(api.deleteBoard).mockResolvedValue({ tarefas_apagadas: 5 });
    montar({ selecionado: "b-pauta" });

    fireEvent.click(screen.getByLabelText("Apagar Pauta editorial"));
    const campo = await screen.findByLabelText(/Digite/);
    fireEvent.change(campo, { target: { value: "Pauta editorial" } });
    fireEvent.click(screen.getByText("Apagar quadro"));

    expect(await screen.findByText(/Alguém mexeu no quadro/)).toBeTruthy();
  });

  it("erro do servidor fica no diálogo, e o quadro não sai da tela", async () => {
    vi.mocked(api.getBoard).mockResolvedValue({
      ...QUADROS[1],
      task_count: 1,
    });
    vi.mocked(api.deleteBoard).mockRejectedValue(
      Object.assign(new Error("Sem permissão neste time."), { status: 403 })
    );
    const props = montar({ selecionado: "b-pauta" });

    fireEvent.click(screen.getByLabelText("Apagar Pauta editorial"));
    const campo = await screen.findByLabelText(/Digite/);
    fireEvent.change(campo, { target: { value: "Pauta editorial" } });
    fireEvent.click(screen.getByText("Apagar quadro"));

    expect(await screen.findByText("Sem permissão neste time.")).toBeTruthy();
    expect(props.onSelecionar).not.toHaveBeenCalled();
  });
});
