/**
 * Spec 036, fatia 5b-6 -- o EditorDeColunas, montado.
 *
 * ⚠️ A REGRA NAO SE TESTA AQUI. Quem decide o que pode ser apagado, quais
 * destinos oferecer, o que o aviso escreve e como traduzir a recusa do backend
 * e `lib/edicaoDeColunas.ts`, com 21 testes proprios. Este arquivo pergunta
 * outra coisa: **o componente LE aquelas respostas, e o que ele manda para a
 * API bate com o que a pessoa escolheu?**
 *
 * ⚠️ E ISSO JA FALHOU DUAS VEZES NESTA SPEC. A 5b-5a entregou
 * `colunaEquivalente` e `rotuloDeColuna` verdes e sem leitor, e a assinatura
 * nao servia quando a tela finalmente as chamou. E o `board_id` do payload de
 * criacao passou por uma sabotagem VERDE porque nenhum teste conferia o que a
 * tela MANDA -- so o que ela desenha.
 *
 * SABOTAGENS (medidas):
 *   AF. Desenhar "Apagar" mesmo com `impedimentoDeExclusao` != null.
 *   AG. `apagarColuna` sem passar o `destinoId`.
 *   AH. `mostrarErro` lendo `err.message` em vez de `explicaRecusa(err.code)`.
 *   AI. O aviso de divergencia nao sendo mostrado.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import EditorDeColunas from "@/components/EditorDeColunas";
import type { Coluna } from "@/lib/coluna";
import {
  CODIGO_SEMANTICA_OBRIGATORIA,
  CODIGO_SEM_DESTINO,
} from "@/lib/edicaoDeColunas";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    criarColuna: vi.fn(),
    renomearColuna: vi.fn(),
    apagarColuna: vi.fn(),
    colunaComContagem: vi.fn(),
  };
});

const api = await import("@/lib/api");

const BOARD = "board-campanhas";

function col(
  id: string,
  name: string,
  position: number,
  semantic: Coluna["semantic"],
): Coluna {
  return {
    id,
    name,
    color: "var(--status-backlog-dot)",
    position,
    semantic,
    notify_deadline: true,
    is_default_target: true,
  };
}

const BACKLOG = col("c-back", "Backlog", 0, "OPEN");
const ANDAMENTO = col("c-and", "Em Andamento", 1, "IN_PROGRESS");
const CONCLUIDO = col("c-done", "Concluído", 2, "DONE");
const CANCELADO = col("c-canc", "Cancelado", 3, "CANCELLED");
const BASE = [BACKLOG, ANDAMENTO, CONCLUIDO, CANCELADO];

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

function montar(colunas: readonly Coluna[] = BASE) {
  const props = {
    boardId: BOARD,
    colunas,
    onMudou: vi.fn(),
    onFechar: vi.fn(),
  };
  render(<EditorDeColunas {...props} />);
  return props;
}

/** Abre o fluxo de apagar `Em Andamento` com `quantas` tarefas dentro. */
async function abrirApagar(quantas: number) {
  vi.mocked(api.colunaComContagem).mockResolvedValue({
    ...ANDAMENTO,
    task_count: quantas,
  });
  const props = montar();
  fireEvent.click(screen.getByLabelText("Apagar Em Andamento"));
  await screen.findByRole("dialog");
  return props;
}

describe("EditorDeColunas -- o que ele desenha", () => {
  it("lista todas as colunas com renomear", () => {
    montar();
    for (const c of BASE) {
      expect(screen.getByLabelText(`Renomear ${c.name}`)).toBeTruthy();
    }
  });

  it("⚠️ a ultima OPEN e a ultima DONE nao mostram Apagar -- mostram o MOTIVO", () => {
    // ⚠️ AUSENTE, e nao desabilitado, mas com a explicacao no lugar. Botao
    // travado sem texto e alguem clicando e perguntando por que nada acontece.
    montar();
    expect(screen.queryByLabelText("Apagar Backlog")).toBeNull();
    expect(screen.queryByLabelText("Apagar Concluído")).toBeNull();
    expect(screen.getAllByText(/precisa de pelo menos uma coluna/i)).toHaveLength(2);
  });

  it("⚠️ mostra o TIPO de cada coluna", () => {
    // ⚠️ ELE ERA INVISIVEL, e a pergunta que revelou isso veio da tela: "como
    // eu edito se ela e de conclusao, em progresso, final ou inicio?". Sem o
    // rotulo, a lista mostra nomes iguais e uma delas, sem explicacao, nao
    // pode ser apagada -- e nao ha como saber por que aquela e nao outra.
    montar();
    expect(screen.getByText("início")).toBeTruthy();
    expect(screen.getByText("conclusão")).toBeTruthy();
    expect(screen.getByText("cancelamento")).toBeTruthy();
  });

  it("⚠️ o formulario de criar deixa ESCOLHER o tipo", () => {
    // ⚠️ CRIAR E SEGURO, EDITAR NAO -- e essa e a distincao inteira. A coluna
    // nasce VAZIA, entao escolher o tipo agora nao muda o significado de
    // tarefa nenhuma. Trocar depois, com tarefas dentro, mudaria.
    montar();
    fireEvent.click(screen.getByText("+ Nova coluna"));
    expect(screen.getByLabelText("Tipo da nova coluna")).toBeTruthy();
    expect(screen.getByText(/não muda depois/i)).toBeTruthy();
  });

  it("⚠️ IN_PROGRESS e CANCELLED mostram Apagar", () => {
    // Quadro de duas colunas e valido -- o sistema nao escreve nestas duas
    // semanticas sozinho.
    montar();
    expect(screen.getByLabelText("Apagar Em Andamento")).toBeTruthy();
    expect(screen.getByLabelText("Apagar Cancelado")).toBeTruthy();
  });
});

describe("EditorDeColunas -- criar e renomear", () => {
  it("criar manda o nome aparado e a semantica do meio", async () => {
    vi.mocked(api.criarColuna).mockResolvedValue(col("c-nova", "Revisão", 4, "IN_PROGRESS"));
    const props = montar();

    fireEvent.click(screen.getByText("+ Nova coluna"));
    fireEvent.change(screen.getByLabelText("Nome da nova coluna"), {
      target: { value: "  Revisão  " },
    });
    fireEvent.click(screen.getByText("Criar"));

    await waitFor(() =>
      expect(vi.mocked(api.criarColuna)).toHaveBeenCalledWith(BOARD, {
        name: "Revisão",
        semantic: "IN_PROGRESS",
      }),
    );
    expect(props.onMudou).toHaveBeenCalled();
  });

  it("renomear manda quadro, coluna e nome novo", async () => {
    vi.mocked(api.renomearColuna).mockResolvedValue(ANDAMENTO);
    montar();

    fireEvent.click(screen.getByLabelText("Renomear Em Andamento"));
    fireEvent.change(screen.getByLabelText("Novo nome de Em Andamento"), {
      target: { value: "Fazendo" },
    });
    fireEvent.click(screen.getByText("Salvar"));

    await waitFor(() =>
      expect(vi.mocked(api.renomearColuna)).toHaveBeenCalledWith(
        BOARD,
        "c-and",
        "Fazendo",
      ),
    );
  });
});

describe("EditorDeColunas -- apagar", () => {
  it("coluna VAZIA some sem pedir destino", async () => {
    vi.mocked(api.apagarColuna).mockResolvedValue(0);
    await abrirApagar(0);

    expect(screen.queryByLabelText("Coluna de destino")).toBeNull();
    fireEvent.click(screen.getByText("Apagar coluna"));

    await waitFor(() =>
      expect(vi.mocked(api.apagarColuna)).toHaveBeenCalledWith(
        BOARD,
        "c-and",
        undefined,
      ),
    );
  });

  it("⚠️ coluna VAZIA que o backend recusa por destino OFERECE o seletor", async () => {
    // ⚠️ ERA UM BECO SEM SAIDA ATE 13/08, e nenhum portao o pegava.
    //
    // A contagem conta so as tarefas VIVAS; `apagar_coluna` exige destino se
    // houver vivas OU APAGADAS, porque a FK `task_board_column` e `RESTRICT` e
    // a linha soft-deleted continua apontando para a coluna. Resultado: a tela
    // dizia "Ela esta vazia", a pessoa confirmava, vinha 422 pedindo destino
    // -- e o seletor nao existia no DOM, porque so aparecia com `quantas > 0`.
    // Aquela coluna nao podia mais ser apagada pelo produto.
    //
    // ⚠️ BASTA UMA TAREFA APAGADA, UMA VEZ. Criar e apagar tarefa e uso normal.
    vi.mocked(api.apagarColuna).mockRejectedValueOnce({
      code: CODIGO_SEM_DESTINO,
      message: "Escolha para qual coluna as tarefas devem ir.",
    });
    await abrirApagar(0);

    // Antes do clique a tela nao tem por que perguntar nada: para quem olha, a
    // coluna esta vazia mesmo.
    expect(screen.queryByLabelText("Coluna de destino")).toBeNull();
    fireEvent.click(screen.getByText("Apagar coluna"));

    // Depois da recusa, o seletor APARECE -- e o texto para de dizer so
    // "esta vazia", que era a metade que mentia.
    const seletor = await screen.findByLabelText("Coluna de destino");
    expect(seletor).toBeTruthy();
    expect(screen.getByText(/guarda tarefas apagadas/i)).toBeTruthy();

    // ...e o botao volta a travar ate a pessoa escolher, em vez de repetir o
    // mesmo 422 a cada clique.
    expect((screen.getByText("Apagar coluna") as HTMLButtonElement).disabled).toBe(
      true,
    );

    vi.mocked(api.apagarColuna).mockResolvedValueOnce(0);
    fireEvent.change(seletor, { target: { value: "c-back" } });
    fireEvent.click(screen.getByText("Apagar coluna"));

    await waitFor(() =>
      expect(vi.mocked(api.apagarColuna)).toHaveBeenLastCalledWith(
        BOARD,
        "c-and",
        "c-back",
      ),
    );
  });

  it("⚠️ com tarefas, o botao fica TRAVADO ate escolher o destino", async () => {
    // A trava D5 da ADR 0042, do lado da tela: o backend recusaria com 422 e
    // `coluna_sem_destino`, e a pessoa levaria erro depois de confirmar.
    await abrirApagar(12);

    const botao = screen.getByText("Apagar coluna") as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
  });

  it("⚠️ manda o destino ESCOLHIDO, e nao outro", async () => {
    vi.mocked(api.apagarColuna).mockResolvedValue(12);
    await abrirApagar(12);

    fireEvent.change(screen.getByLabelText("Coluna de destino"), {
      target: { value: "c-back" },
    });
    fireEvent.click(screen.getByText("Apagar coluna"));

    await waitFor(() =>
      expect(vi.mocked(api.apagarColuna)).toHaveBeenCalledWith(
        BOARD,
        "c-and",
        "c-back",
      ),
    );
  });

  it("⚠️ destino TERMINAL muda o aviso e o rotulo do botao", async () => {
    // ⚠️ NAO E MOVER -- E CONCLUIR O LOTE. Quem le "as 12 tarefas vão para
    // Concluído" entende que esta arrumando o quadro; o que acontece e
    // encerrar 12 trabalhos, com cascata de subtarefas e prazos morrendo.
    await abrirApagar(12);

    fireEvent.change(screen.getByLabelText("Coluna de destino"), {
      target: { value: "c-done" },
    });

    expect(screen.getByText(/marcar 12 tarefas como concluídas/i)).toBeTruthy();
    expect(screen.getByText(/subtarefas/i)).toBeTruthy();
    expect(screen.getByText("Apagar e marcar como concluídas")).toBeTruthy();
  });

  it("⚠️ o numero do DELETE vence o do aviso, e a divergencia aparece", async () => {
    // A contagem envelhece entre o `GET` e o `DELETE`: alguem pode mover uma
    // tarefa para ca no meio. Dois numeros discordando sobre a mesma coisa e
    // pior que um numero velho.
    vi.mocked(api.apagarColuna).mockResolvedValue(14);
    await abrirApagar(12);

    fireEvent.change(screen.getByLabelText("Coluna de destino"), {
      target: { value: "c-back" },
    });
    fireEvent.click(screen.getByText("Apagar coluna"));

    const aviso = await screen.findByRole("status");
    expect(aviso.textContent).toContain("14");
  });
});

describe("EditorDeColunas -- as recusas do backend", () => {
  it("⚠️ traduz o codigo da SEMANTICA em algo que explica", async () => {
    // ⚠️ AS DUAS RECUSAS SAO 422. Distingui-las pela mensagem acoplaria a tela
    // ao portugues do backend -- uma virgula corrigida la quebraria o produto
    // em silencio.
    vi.mocked(api.apagarColuna).mockRejectedValue(
      Object.assign(new Error("erro cru do backend"), {
        code: CODIGO_SEMANTICA_OBRIGATORIA,
      }),
    );
    await abrirApagar(0);
    fireEvent.click(screen.getByText("Apagar coluna"));

    const erro = await screen.findByRole("alert");
    expect(erro.textContent).toContain("Crie outra");
    expect(erro.textContent).not.toContain("erro cru do backend");
  });

  it("traduz o codigo de DESTINO diferente do da semantica", async () => {
    vi.mocked(api.apagarColuna).mockRejectedValue(
      Object.assign(new Error("cru"), { code: CODIGO_SEM_DESTINO }),
    );
    await abrirApagar(0);
    fireEvent.click(screen.getByText("Apagar coluna"));

    const erro = await screen.findByRole("alert");
    expect(erro.textContent).toContain("Escolha para qual coluna");
  });

  it("⚠️ codigo desconhecido mostra a mensagem do BACKEND", async () => {
    // Inventar texto proprio para erro que nao previmos esconderia a causa de
    // quem esta olhando a tela.
    vi.mocked(api.apagarColuna).mockRejectedValue(
      Object.assign(new Error("Sem permissão neste time."), { code: "forbidden" }),
    );
    await abrirApagar(0);
    fireEvent.click(screen.getByText("Apagar coluna"));

    const erro = await screen.findByRole("alert");
    expect(erro.textContent).toContain("Sem permissão neste time.");
  });

  it("⚠️ o tipo ESCOLHIDO vai no payload, e nao um fixo", async () => {
    // ⚠️ A VERSAO ANTERIOR MANDAVA `IN_PROGRESS` SEMPRE. Sem esta assercao,
    // voltar ao fixo deixaria o seletor na tela sem efeito nenhum -- a pessoa
    // escolhe "conclusão" e nasce "em andamento", sem erro.
    vi.mocked(api.criarColuna).mockResolvedValue(
      col("c-nova", "Entregue", 4, "DONE"),
    );
    montar();

    fireEvent.click(screen.getByText("+ Nova coluna"));
    fireEvent.change(screen.getByLabelText("Nome da nova coluna"), {
      target: { value: "Entregue" },
    });
    fireEvent.change(screen.getByLabelText("Tipo da nova coluna"), {
      target: { value: "DONE" },
    });
    fireEvent.click(screen.getByText("Criar"));

    await waitFor(() =>
      expect(vi.mocked(api.criarColuna)).toHaveBeenCalledWith(BOARD, {
        name: "Entregue",
        semantic: "DONE",
      }),
    );
  });
});
