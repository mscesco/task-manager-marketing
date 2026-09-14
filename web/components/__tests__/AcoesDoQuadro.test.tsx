/**
 * Spec 036, fatia 10 -- RENOMEAR e APAGAR quadro, na barra do modo de edição.
 *
 * ⚠️ ESTE ARQUIVO NASCEU DO `SeletorDeQuadro.test.tsx`, e os testes de renomear
 * e apagar foram MOVIDOS para cá, não reescritos do zero. As sabotagens são as
 * mesmas -- inclusive as da fatia 7, que são a única coisa que prende a
 * confirmação por digitação: a conferência visual não roda a cada commit.
 *
 * ⚠️ A REGRA DE QUEM PODE O QUE NÃO SE TESTA AQUI. Ela é do
 * `lib/seletorDeQuadro.ts` (`opcoesDoSeletor` -> `podeRenomear`/`podeApagar`),
 * que tem testes próprios e não mudou nesta fatia. Aqui perguntamos se o
 * componente LÊ aquelas respostas.
 *
 * SABOTAGENS (medidas):
 *   R. Desenhar "Renomear"/"Apagar" ignorando `podeRenomear`/`podeApagar`.
 *   W. Renomear trocando a seleção (a pessoa sai do quadro que estava vendo).
 *   X. Apagar sem sair do quadro apagado -> o "Carregando…" eterno.
 *   Y. `?? 0` no lugar do travamento por contagem ausente.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AcoesDoQuadro from "@/components/AcoesDoQuadro";
import type { Quadro } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
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

function montar(over: Partial<Parameters<typeof AcoesDoQuadro>[0]> = {}) {
  const props = {
    teamId: SEO,
    quadros: QUADROS,
    selecionado: "b-pauta" as string | null,
    podeGerir: true,
    onSelecionar: vi.fn(),
    onMudou: vi.fn(),
    // ⚠️ `false` porque o `SEO` é SUBTIME. Obrigatória desde 14/09; quem testa a
    // raiz sobrescreve pelo `over`.
    daRaiz: false,
    ...over,
  };
  render(<AcoesDoQuadro {...props} />);
  return props;
}

describe("AcoesDoQuadro -- o que ele oferece", () => {
  it("no quadro avulso, oferece renomear e apagar", () => {
    montar();
    expect(screen.getByLabelText("Renomear Pauta editorial")).toBeTruthy();
    expect(screen.getByLabelText("Apagar Pauta editorial")).toBeTruthy();
  });

  it("⚠️ na LENTE não desenha NADA -- nem desabilitado", () => {
    // ADR 0034 item 2: ausente, e nao desabilitada. A lente nao tem registro no
    // banco: nao ha o que renomear nem o que apagar. Sabotagem R.
    const { container } = render(
      <AcoesDoQuadro
        teamId={SEO}
        quadros={QUADROS}
        selecionado={null}
        podeGerir
        onSelecionar={vi.fn()}
        onMudou={vi.fn()}
        daRaiz={false}
      />
    );
    expect(container.textContent).toBe("");
  });

  it("⚠️ sem permissão não desenha NADA", () => {
    montar({ podeGerir: false });
    expect(screen.queryByLabelText(/^Renomear /)).toBeNull();
    expect(screen.queryByLabelText(/^Apagar /)).toBeNull();
  });
});

describe("AcoesDoQuadro -- renomear", () => {
  it("abre com o nome ATUAL preenchido", () => {
    montar();
    fireEvent.click(screen.getByLabelText("Renomear Pauta editorial"));
    expect(
      (screen.getByLabelText("Novo nome do quadro") as HTMLInputElement).value
    ).toBe("Pauta editorial");
  });

  it("manda o id do quadro e o nome novo -- sabotagem W", async () => {
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

  it("⚠️ nome só com espaço NÃO chega na API", async () => {
    montar();
    fireEvent.click(screen.getByLabelText("Renomear Pauta editorial"));
    fireEvent.change(screen.getByLabelText("Novo nome do quadro"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByText("Salvar"));

    await screen.findByRole("alert");
    expect(vi.mocked(api.renameBoard)).not.toHaveBeenCalled();
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

  it("erro da API aparece, com a mensagem do backend", async () => {
    // ⚠️ E ela quem distingue "sem permissao neste time" de "nome duplicado"
    // (fatia 9) -- texto fixo aqui esconderia a causa.
    vi.mocked(api.renameBoard).mockRejectedValue(
      Object.assign(new Error(), { message: "Já existe um quadro com esse nome." })
    );
    montar();
    fireEvent.click(screen.getByLabelText("Renomear Pauta editorial"));
    fireEvent.change(screen.getByLabelText("Novo nome do quadro"), {
      target: { value: "Automações" },
    });
    fireEvent.click(screen.getByText("Salvar"));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Já existe um quadro com esse nome."
    );
  });
});

describe("AcoesDoQuadro -- apagar quadro (fatia 7)", () => {
  // ⚠️ É A OPERAÇÃO MAIS DESTRUTIVA DO PRODUTO, e a única que não pergunta o
  // destino das tarefas. Estes testes são a única coisa que prende a
  // confirmação -- a conferência visual não roda a cada commit.

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
    // ⚠️ SENSIVEL A MAIUSCULA, de proposito: a confirmacao existe para obrigar
    // a pessoa a LER o nome. E e a mesma regra do nome unico (fatia 9).
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

  it("⚠️ enquanto a contagem não chega, não dá para confirmar -- sabotagem Y", async () => {
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

  it("confirma, sai do quadro apagado e manda recarregar -- sabotagem X", async () => {
    vi.mocked(api.getBoard).mockResolvedValue({
      ...QUADROS[1],
      task_count: 3,
    });
    vi.mocked(api.deleteBoard).mockResolvedValue({ tarefas_apagadas: 3 });
    const props = montar();

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

  it("⚠️ contagem diferente do apagado AVISA", async () => {
    // Alguém criou tarefa entre a leitura e o clique. Dois números sobre a
    // mesma coisa é pior que um número velho -- mesmo desenho do lote.
    vi.mocked(api.getBoard).mockResolvedValue({
      ...QUADROS[1],
      task_count: 3,
    });
    vi.mocked(api.deleteBoard).mockResolvedValue({ tarefas_apagadas: 5 });
    montar();

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
    const props = montar();

    fireEvent.click(screen.getByLabelText("Apagar Pauta editorial"));
    const campo = await screen.findByLabelText(/Digite/);
    fireEvent.change(campo, { target: { value: "Pauta editorial" } });
    fireEvent.click(screen.getByText("Apagar quadro"));

    expect(await screen.findByText("Sem permissão neste time.")).toBeTruthy();
    expect(props.onSelecionar).not.toHaveBeenCalled();
  });

  it("⚠️ com o diálogo aberto, o GATILHO de apagar sai da árvore", async () => {
    // ⚠️ Os dois se chamam "Apagar quadro" -- o gatilho e o confirmar. Com os
    // dois na arvore, quem usa leitor de tela ouve dois botoes de mesmo nome
    // com pesos completamente diferentes. Achado escrevendo este arquivo:
    // `getByText` quebrou com "found multiple elements".
    vi.mocked(api.getBoard).mockResolvedValue({ ...QUADROS[1], task_count: 1 });
    montar();
    fireEvent.click(screen.getByLabelText("Apagar Pauta editorial"));
    await screen.findByLabelText(/Digite/);
    expect(screen.queryByLabelText("Apagar Pauta editorial")).toBeNull();
    expect(screen.getAllByText("Apagar quadro")).toHaveLength(1);
  });
});
