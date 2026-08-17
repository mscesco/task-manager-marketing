/**
 * A tela do modo de edição de colunas (Spec 036, fatia 6c-2).
 *
 * ⚠️ O QUE ESTE ARQUIVO NÃO PODE PEGAR: o arraste de cabeçalho. `onDragEnd` não
 * roda em jsdom -- o produto já tem dois assim, e este é o terceiro. É por isso
 * que as SETAS existem: elas chamam a mesma função pura que o arraste
 * (`comOrdem`, testada em `rascunhoDeColunas.test.ts`), e são o único caminho
 * que fica preso aqui.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import CabecalhoDeColunaEditavel from "@/components/CabecalhoDeColunaEditavel";
import FormNovaColuna from "@/components/FormNovaColuna";
import type { LinhaDeEdicao } from "@/lib/rascunhoDeColunas";

afterEach(cleanup);

function linha(over: Partial<LinhaDeEdicao> = {}): LinhaDeEdicao {
  return {
    ref: "c1",
    nome: "Backlog",
    semantic: "OPEN",
    apagada: false,
    nova: false,
    alvo: false,
    impedimento: null,
    ...over,
  };
}

function montar(over: Partial<LinhaDeEdicao> = {}, props: Partial<Record<string, unknown>> = {}) {
  const onRenomear = vi.fn();
  const onMarcar = vi.fn();
  const onMover = vi.fn();
  render(
    <CabecalhoDeColunaEditavel
      linha={linha(over)}
      cor="#123456"
      podeIrEsquerda
      podeIrDireita
      onRenomear={onRenomear}
      onMarcar={onMarcar}
      onMover={onMover}
      {...props}
    />,
  );
  return { onRenomear, onMarcar, onMover };
}

describe("CabecalhoDeColunaEditavel -- renomear no lugar", () => {
  it("clicar no nome abre o campo JÁ com foco", () => {
    // ⚠️ Sem o foco, a pessoa clica no nome, o campo aparece, e ela precisa
    // clicar de novo -- e quem usa leitor de tela não sabe que pode digitar.
    montar();
    fireEvent.click(screen.getByText("Backlog"));
    const campo = screen.getByLabelText("Nome da coluna Backlog");
    expect(document.activeElement).toBe(campo);
  });

  it("Enter confirma o nome novo", () => {
    const { onRenomear } = montar();
    fireEvent.click(screen.getByText("Backlog"));
    const campo = screen.getByLabelText("Nome da coluna Backlog");
    fireEvent.change(campo, { target: { value: "A fazer" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(onRenomear).toHaveBeenCalledWith("A fazer");
  });

  it("⚠️ Esc desfaz e NÃO renomeia", () => {
    const { onRenomear } = montar();
    fireEvent.click(screen.getByText("Backlog"));
    const campo = screen.getByLabelText("Nome da coluna Backlog");
    fireEvent.change(campo, { target: { value: "A fazer" } });
    fireEvent.keyDown(campo, { key: "Escape" });
    expect(onRenomear).not.toHaveBeenCalled();
    expect(screen.getByText("Backlog")).toBeTruthy();
  });

  it("⚠️ nome vazio não vira renomeação", () => {
    // ⚠️ O backend recusaria com 422 -- e no LOTE isso derruba a edição
    // inteira, por um campo que a pessoa só limpou antes de desistir.
    const { onRenomear } = montar();
    fireEvent.click(screen.getByText("Backlog"));
    const campo = screen.getByLabelText("Nome da coluna Backlog");
    fireEvent.change(campo, { target: { value: "   " } });
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(onRenomear).not.toHaveBeenCalled();
  });

  it("nome igual ao atual também não vira renomeação", () => {
    const { onRenomear } = montar();
    fireEvent.click(screen.getByText("Backlog"));
    fireEvent.keyDown(screen.getByLabelText("Nome da coluna Backlog"), {
      key: "Enter",
    });
    expect(onRenomear).not.toHaveBeenCalled();
  });

  it("⚠️ Esc no campo não escapa para o modo de edição", () => {
    // Sem `stopPropagation`, o mesmo Esc que desfaz o nome fecharia o modo de
    // edição inteiro -- e a pessoa perderia todo o rascunho por corrigir um
    // nome que digitou errado.
    const noPai = vi.fn();
    render(
      <div onKeyDown={noPai}>
        <CabecalhoDeColunaEditavel
          linha={linha()}
          cor="#123456"
          podeIrEsquerda
          podeIrDireita
          onRenomear={vi.fn()}
          onMarcar={vi.fn()}
          onMover={vi.fn()}
        />
      </div>,
    );
    fireEvent.click(screen.getAllByText("Backlog")[0]);
    fireEvent.keyDown(screen.getByLabelText("Nome da coluna Backlog"), {
      key: "Escape",
    });
    expect(noPai).not.toHaveBeenCalled();
  });
});

describe("CabecalhoDeColunaEditavel -- marcar e desmarcar", () => {
  it("o × reporta a marcação", () => {
    const { onMarcar } = montar();
    fireEvent.click(screen.getByLabelText("Apagar Backlog"));
    expect(onMarcar).toHaveBeenCalled();
  });

  it("⚠️ a marcada fica riscada e continua na tela, com desfazer", () => {
    // Sumir no clique contradiria o modelo: enquanto não concluir, nada
    // aconteceu, e a pessoa precisa poder voltar atrás.
    montar({ apagada: true });
    expect(screen.getByLabelText("Manter Backlog")).toBeTruthy();
    expect(screen.getByText("Backlog")).toBeTruthy();
  });

  it("⚠️ a marcada não pode ser renomeada", () => {
    const { onRenomear } = montar({ apagada: true });
    fireEvent.click(screen.getByText("Backlog"));
    expect(screen.queryByLabelText("Nome da coluna Backlog")).toBeNull();
    expect(onRenomear).not.toHaveBeenCalled();
  });

  it("⚠️ com impedimento, o botão NÃO EXISTE -- e o motivo aparece", () => {
    // ⚠️ Desabilitado seria pior: a pessoa clica, nada acontece, e ela não sabe
    // se o produto travou ou se ela não pode.
    montar({ impedimento: "Este quadro precisa de uma coluna aberta." });
    expect(screen.queryByLabelText("Apagar Backlog")).toBeNull();
    expect(screen.getByText("não pode ser apagada")).toBeTruthy();
  });
});

describe("CabecalhoDeColunaEditavel -- setas e selo", () => {
  it("as setas reportam a direção", () => {
    const { onMover } = montar();
    fireEvent.click(screen.getByLabelText("Mover Backlog para a esquerda"));
    fireEvent.click(screen.getByLabelText("Mover Backlog para a direita"));
    expect(onMover).toHaveBeenNthCalledWith(1, "esquerda");
    expect(onMover).toHaveBeenNthCalledWith(2, "direita");
  });

  it("⚠️ na ponta a seta fica DESABILITADA", () => {
    // ⚠️ É o par do `null` de `comOrdem`. Botão que existe, aceita clique e não
    // faz nada é pior que botão ausente: o leitor de tela anuncia e nada
    // acontece.
    montar({}, { podeIrEsquerda: false });
    expect(
      (screen.getByLabelText("Mover Backlog para a esquerda") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("⚠️ o selo de alvo aparece só em quem é alvo", () => {
    // ADR 0030: o destino da cascata é `is_default_target` e NÃO a primeira
    // pela ordem. Sem o selo, alguém põe "Entregue" antes de "Concluído" e
    // espera que as tarefas caiam lá -- e não vão, sem nada avisar.
    montar({ alvo: true });
    expect(screen.getByText("padrão")).toBeTruthy();
    cleanup();
    montar({ alvo: false });
    expect(screen.queryByText("padrão")).toBeNull();
  });

  it("a alça de arraste existe e é rotulada", () => {
    montar();
    expect(screen.getByLabelText("Arrastar Backlog")).toBeTruthy();
  });
});

describe("FormNovaColuna", () => {
  function montarForm() {
    const onCriar = vi.fn();
    const onCancelar = vi.fn();
    render(<FormNovaColuna onCriar={onCriar} onCancelar={onCancelar} />);
    return { onCriar, onCancelar };
  }

  it("abre com o foco no nome", () => {
    montarForm();
    expect(document.activeElement).toBe(screen.getByLabelText("Nome da coluna"));
  });

  it("cria com nome e tipo", () => {
    const { onCriar } = montarForm();
    fireEvent.change(screen.getByLabelText("Nome da coluna"), {
      target: { value: "Aguardando cliente" },
    });
    fireEvent.change(screen.getByLabelText("Tipo"), {
      target: { value: "DONE" },
    });
    fireEvent.click(screen.getByText("Criar"));
    expect(onCriar).toHaveBeenCalledWith("Aguardando cliente", "DONE");
  });

  it("⚠️ o botão fica travado sem nome", () => {
    montarForm();
    expect((screen.getByText("Criar") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Nome da coluna"), {
      target: { value: "   " },
    });
    expect((screen.getByText("Criar") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Esc cancela", () => {
    const { onCancelar } = montarForm();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancelar).toHaveBeenCalled();
  });

  it("⚠️ NÃO tem campo de cor", () => {
    // ⚠️ Decisão de 13/08: cor virou fatia própria. Hoje ela sai de
    // `_cor_por_rotacao` sobre os 8 tokens, com contraste conferido; hex livre
    // exige schema, validação e a decisão paleta × livre. Se este teste ficar
    // vermelho, alguém trouxe a fatia para dentro sem passar pelo plano.
    montarForm();
    expect(screen.queryByLabelText(/cor/i)).toBeNull();
  });

  it("⚠️ o aviso do tipo fala do FUTURO, e diz o motivo", () => {
    montarForm();
    expect(screen.getByText(/não muda depois/i)).toBeTruthy();
  });
});
