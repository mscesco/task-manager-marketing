/**
 * A revisão ao concluir a edição de colunas: a última chance antes de mover
 * ou concluir tarefas em lote. Nenhum "descartar" desfaz depois de confirmar.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import RevisaoDaEdicao from "@/components/RevisaoDaEdicao";
import type { DestinoPossivel } from "@/components/RevisaoDaEdicao";
import type { Coluna } from "@/lib/coluna";

afterEach(cleanup);

function col(id: string, name: string, semantic: Coluna["semantic"]): Coluna {
  return {
    id,
    name,
    color: "#000",
    position: 0,
    semantic,
    notify_deadline: true,
    is_default_target: false,
    is_status_bridge: false,
  };
}

const EM_ANDAMENTO = col("c2", "Em Andamento", "IN_PROGRESS");
const CANCELADO = col("c4", "Cancelado", "CANCELLED");

const DESTINOS: DestinoPossivel[] = [
  { ref: "c1", nome: "Backlog", semantic: "OPEN" },
  { ref: "c3", nome: "Concluído", semantic: "DONE" },
  { ref: "tmp:1", nome: "Entregue", semantic: "DONE" },
];

function montar(over: Partial<Parameters<typeof RevisaoDaEdicao>[0]> = {}) {
  const onConfirmar = vi.fn();
  const onVoltar = vi.fn();
  render(
    <RevisaoDaEdicao
      marcadas={[EM_ANDAMENTO]}
      destinos={DESTINOS}
      contagens={{ c2: 12 }}
      resumo={{ criadas: 0, renomeadas: 0, ordemMudou: false }}
      erro={null}
      ocupado={false}
      onConfirmar={onConfirmar}
      onVoltar={onVoltar}
      {...over}
    />,
  );
  return { onConfirmar, onVoltar };
}

describe("RevisaoDaEdicao -- o destino", () => {
  it("⚠️ com tarefas dentro, o botão fica TRAVADO até escolher", () => {
    // ⚠️ Nada de pré-selecionar quando há consequência: a primeira opção pode
    // ser terminal, e alguém confirmaria sem ler.
    const { onConfirmar } = montar();
    const botao = screen.getByText("Confirmar alterações") as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.change(
      screen.getByLabelText("Para onde vão as tarefas de Em Andamento"),
      { target: { value: "c1" } },
    );
    expect((screen.getByText("Confirmar alterações") as HTMLButtonElement).disabled)
      .toBe(false);
    fireEvent.click(screen.getByText("Confirmar alterações"));
    expect(onConfirmar).toHaveBeenCalledWith({ c2: "c1" });
  });

  it("⚠️ a coluna criada no rascunho aparece como destino, marcada como nova", () => {
    // Trocar uma coluna por outra num gesto: sem `tmp:` no seletor, seria
    // criar, salvar, e só então apagar.
    montar();
    const opcoes = Array.from(
      screen
        .getByLabelText("Para onde vão as tarefas de Em Andamento")
        .querySelectorAll("option"),
    ).map((o) => o.textContent);
    expect(opcoes).toContain("Entregue (nova)");
  });

  it("⚠️ a coluna VAZIA também pergunta destino -- e vem pré-escolhida", () => {
    // A contagem conta só as tarefas VIVAS, mas o backend exige destino se
    // houver vivas OU APAGADAS (FK `RESTRICT`).
    const { onConfirmar } = montar({
      marcadas: [CANCELADO],
      contagens: { c4: 0 },
    });
    expect((screen.getByText("Confirmar alterações") as HTMLButtonElement).disabled)
      .toBe(false);

    // O texto explica por que pergunta, e no condicional ("pode"): o front
    // não sabe se há apagadas. Só esta afirmação prende `exigeDestino`, porque
    // o seletor é desenhado sempre.
    expect(screen.getByText(/pode guardar tarefas apagadas/i)).toBeTruthy();
    expect(screen.queryByText(/ainda guarda tarefas apagadas/i)).toBeNull();

    fireEvent.click(screen.getByText("Confirmar alterações"));
    expect(onConfirmar).toHaveBeenCalledWith({ c4: "c1" });
  });

  it("⚠️ outra coluna MARCADA não é oferecida como destino", () => {
    // Mandar tarefas para uma coluna que o mesmo lote apaga produziria um
    // encadeamento que ninguém pediu -- e o resultado dependeria de qual "×"
    // foi clicado primeiro.
    montar({
      marcadas: [EM_ANDAMENTO, CANCELADO],
      destinos: [...DESTINOS, { ref: "c4", nome: "Cancelado", semantic: "CANCELLED" }],
      contagens: { c2: 3, c4: 1 },
    });
    const opcoes = Array.from(
      screen
        .getByLabelText("Para onde vão as tarefas de Em Andamento")
        .querySelectorAll("option"),
    ).map((o) => o.textContent);
    expect(opcoes).not.toContain("Cancelado");
  });
});

describe("RevisaoDaEdicao -- o aviso", () => {
  it("⚠️ destino TERMINAL muda o texto -- não é mover, é concluir", () => {
    // ⚠️ Uma pessoa que lê "as 12 tarefas vão para Concluído" entende que está
    // arrumando o quadro; o que ela está fazendo é encerrar 12 trabalhos, com
    // cascata nas subtarefas e o relógio do arquivamento ligado.
    montar();
    fireEvent.change(
      screen.getByLabelText("Para onde vão as tarefas de Em Andamento"),
      { target: { value: "c3" } },
    );
    // Afirma o TÍTULO, a frase que a pessoa lê antes de decidir.
    expect(
      screen.getByText("Isto vai marcar 12 tarefas como concluídas."),
    ).toBeTruthy();
  });

  it("destino comum fala em mover, e diz o número", () => {
    montar();
    fireEvent.change(
      screen.getByLabelText("Para onde vão as tarefas de Em Andamento"),
      { target: { value: "c1" } },
    );
    expect(screen.getByText(/12 tarefas vão para "Backlog"/)).toBeTruthy();
  });

  it("enquanto as contagens não chegam, não dá para confirmar", () => {
    // ⚠️ O número tem de ser o do MOMENTO DA DECISÃO: entre marcar o "×" e
    // concluir, alguém pode ter criado tarefa naquela coluna.
    montar({ contagens: null });
    expect((screen.getByText("Confirmar alterações") as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.getByText("Contando as tarefas…")).toBeTruthy();
  });
});

describe("RevisaoDaEdicao -- moldura", () => {
  it("abre com o foco na caixa e Esc volta", () => {
    const { onVoltar } = montar();
    const dialogo = screen.getByRole("dialog");
    expect(document.activeElement).toBe(dialogo);
    fireEvent.keyDown(dialogo, { key: "Escape" });
    expect(onVoltar).toHaveBeenCalled();
  });

  it("⚠️ com o lote em voo, Esc NÃO volta e os controles travam", () => {
    // Voltar no meio do `PUT` deixaria a tela mostrando um rascunho que o
    // servidor já pode ter aplicado.
    const { onVoltar } = montar({ ocupado: true });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onVoltar).not.toHaveBeenCalled();
    expect((screen.getByText("Voltar") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Aplicando…")).toBeTruthy();
  });

  it("⚠️ o botão de confirmar é DESTRUTIVO quando há exclusão", () => {
    // ⚠️ Prende o nome da classe, não a pintura -- o `include` do vitest não lê
    // `globals.css`. Mesmo assim vale: sem isto, trocar por `btn-primary` numa
    // limpeza devolveria ao gesto mais perigoso do produto a cor do "Salvar".
    montar();
    expect(screen.getByText("Confirmar alterações").className).toContain(
      "btn-danger",
    );
  });

  it("o resumo lista o que não precisa de pergunta", () => {
    montar({
      marcadas: [],
      contagens: {},
      resumo: { criadas: 1, renomeadas: 2, ordemMudou: true },
    });
    expect(screen.getByText("1 coluna nova")).toBeTruthy();
    expect(screen.getByText("2 colunas renomeadas")).toBeTruthy();
    expect(screen.getByText("A ordem das colunas mudou")).toBeTruthy();
  });

  it("erro do servidor aparece como alerta", () => {
    montar({ erro: "Alguém mexeu nas colunas enquanto você editava." });
    expect(screen.getByRole("alert").textContent).toContain("Alguém mexeu");
  });
});
