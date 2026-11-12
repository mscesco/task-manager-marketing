/**
 * A tela do modo de edição de colunas.
 *
 * ⚠️ O QUE ESTE ARQUIVO NÃO PODE PEGAR: o arraste de cabeçalho (`onDragEnd` não
 * roda em jsdom). As SETAS chamam a mesma função pura que o arraste
 * (`comOrdem`, testada em `rascunhoDeColunas.test.ts`) e são o único caminho
 * que fica preso aqui.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import CabecalhoDeColunaEditavel from "@/components/CabecalhoDeColunaEditavel";
import FormNovaColuna from "@/components/FormNovaColuna";
import type { LinhaDeEdicao } from "@/lib/rascunhoDeColunas";
import { CORES_DE_COLUNA } from "@/lib/coluna";

afterEach(cleanup);

function linha(over: Partial<LinhaDeEdicao> = {}): LinhaDeEdicao {
  return {
    ref: "c1",
    nome: "Backlog",
    semantic: "OPEN",
    apagada: false,
    nova: false,
    alvo: false,
    alvoPedido: false,
    impedimento: null,
    // O default do produto: coluna cobra prazo.
    avisaPrazo: true,
    ...over,
  };
}

function montar(over: Partial<LinhaDeEdicao> = {}, props: Partial<Record<string, unknown>> = {}) {
  const onRenomear = vi.fn();
  const onMarcar = vi.fn();
  const onTornarAlvo = vi.fn();
  const onAvisar = vi.fn();
  const onMover = vi.fn();
  render(
    <CabecalhoDeColunaEditavel
      linha={linha(over)}
      cor="#123456"
      podeIrEsquerda
      podeIrDireita
      onRenomear={onRenomear}
      onMarcar={onMarcar}
      podeApagar
      onTornarAlvo={onTornarAlvo}
      onAvisar={onAvisar}
      onMover={onMover}
      {...props}
    />,
  );
  return { onRenomear, onMarcar, onTornarAlvo, onAvisar, onMover };
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
          podeApagar
          onTornarAlvo={vi.fn()}
          onAvisar={vi.fn()}
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

describe("CabecalhoDeColunaEditavel -- sem `column.delete`", () => {
  it("⚠️ não oferece apagar coluna salva -- o GESTOR edita e não apaga", () => {
    montar({}, { podeApagar: false });
    expect(screen.queryByLabelText("Apagar Backlog")).toBeNull();
  });

  it("nem explica uma trava que não é dele", () => {
    montar({ impedimento: "é o alvo de OPEN" }, { podeApagar: false });
    expect(screen.queryByText("não pode ser apagada")).toBeNull();
  });

  it("mas tira do rascunho a coluna que ele mesmo criou -- isso não é apagar", () => {
    montar({ nova: true, nome: "Entregue" }, { podeApagar: false });
    expect(screen.getByLabelText("Apagar Entregue")).toBeTruthy();
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
    // O destino da cascata é `is_default_target` e NÃO a primeira
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

  it("cria com nome e tipo -- e, sem escolher, cor `undefined` e prazo cobrado", () => {
    const { onCriar } = montarForm();
    fireEvent.change(screen.getByLabelText("Nome da coluna"), {
      target: { value: "Aguardando cliente" },
    });
    fireEvent.change(screen.getByLabelText("Tipo"), {
      target: { value: "DONE" },
    });
    fireEvent.click(screen.getByText("Criar"));
    // ⚠️ `undefined` e não uma cor concreta: "a rotação do backend decide". Um
    // default concreto aqui faria todas as colunas novas saírem da mesma cor.
    expect(onCriar).toHaveBeenCalledWith(
      "Aguardando cliente",
      "DONE",
      undefined,
      true,
    );
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

  it("⚠️ a cor sai de uma PALETA de tokens -- não há campo de hex", () => {
    // `<input type="color">` devolveria hex, e hex não inverte no tema escuro.
    montarForm();
    expect(document.querySelector('input[type="color"]')).toBeNull();
    expect(
      screen.getByRole("radiogroup", { name: "Cor" }),
    ).toBeTruthy();
    // Os tentos da paleta mais a opção "Automática".
    expect(screen.getAllByRole("radio").length).toBe(CORES_DE_COLUNA.length + 1);
  });

  it('⚠️ "Automática" vem marcada, e é uma escolha de verdade', () => {
    // Sem ela, quem só quer uma coluna nova seria obrigado a ter opinião sobre
    // cor -- e o comportamento de sempre (rotação do backend) deixaria de ser
    // alcançável pela tela.
    montarForm();
    expect(
      screen.getByRole("radio", { name: "Automática" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("escolher um tento manda o TOKEN, e não um hex", () => {
    const { onCriar } = montarForm();
    fireEvent.change(screen.getByLabelText("Nome da coluna"), {
      target: { value: "Ideias" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Cor 3" }));
    fireEvent.click(screen.getByText("Criar"));
    expect(onCriar).toHaveBeenCalledWith(
      "Ideias",
      "IN_PROGRESS",
      CORES_DE_COLUNA[2],
      true,
    );
  });

  it("⚠️ desmarcar “Cobrar prazo” chega no `onCriar`", () => {
    // Uma coluna como "Aguardando cliente" não deve cobrar prazo.
    const { onCriar } = montarForm();
    fireEvent.change(screen.getByLabelText("Nome da coluna"), {
      target: { value: "Aguardando cliente" },
    });
    fireEvent.click(screen.getByLabelText(/Cobrar prazo nesta coluna/));
    fireEvent.click(screen.getByText("Criar"));
    expect(onCriar).toHaveBeenCalledWith(
      "Aguardando cliente",
      "IN_PROGRESS",
      undefined,
      false,
    );
  });

  it("⚠️ em coluna TERMINAL a caixa some -- controle inerte é mentira", () => {
    // Em Concluído e Cancelado o backend IGNORA a flag; deixar a
    // caixa na tela prometeria um efeito que não existe.
    montarForm();
    expect(screen.getByLabelText(/Cobrar prazo nesta coluna/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Tipo"), {
      target: { value: "DONE" },
    });
    expect(screen.queryByLabelText(/Cobrar prazo nesta coluna/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Tipo"), {
      target: { value: "CANCELLED" },
    });
    expect(screen.queryByLabelText(/Cobrar prazo nesta coluna/)).toBeNull();
  });

  it("⚠️ a caixa DIZ a consequência, e não só o nome do campo", () => {
    // Sem o texto, alguém desmarca para tirar vermelho da tela e silencia
    // notificação sem saber -- e o backend não guarda quem desligou.
    montarForm();
    expect(screen.getByText(/não geram aviso de prazo/i)).toBeTruthy();
  });

  it("⚠️ o aviso do tipo fala do FUTURO, e diz o motivo", () => {
    montarForm();
    expect(screen.getByText(/não muda depois/i)).toBeTruthy();
  });
});

describe("CabecalhoDeColunaEditavel -- o selo da coluna nova", () => {
  it('⚠️ coluna do rascunho é marcada "nova"', () => {
    // A coluna criada aparece no quadro, para ser posicionada no mesmo gesto
    // em que nasce. Sem este selo ela fica
    // indistinguível de uma coluna vazia de verdade -- e a diferença importa:
    // sair sem concluir a descarta, e a cor dela ainda vai ser escolhida pelo
    // servidor.
    montar({ ref: "tmp:1", nome: "Entregue", semantic: "DONE", nova: true });
    expect(screen.getByText("nova")).toBeTruthy();
  });

  it("coluna que já existe NÃO ganha o selo", () => {
    montar();
    expect(screen.queryByText("nova")).toBeNull();
  });

  it("⚠️ a coluna nova pode ser movida e apagada como qualquer outra", () => {
    // ⚠️ APAGAR UMA `tmp:` É REMOVER DO RASCUNHO, e não marcar (`comMarcacao`
    // trata os dois casos). O cabeçalho não precisa saber a diferença, mas o
    // "×" e as setas têm de existir para ela.
    const { onMover, onMarcar } = montar({
      ref: "tmp:1",
      nome: "Entregue",
      semantic: "DONE",
      nova: true,
    });
    fireEvent.click(screen.getByLabelText("Mover Entregue para a esquerda"));
    expect(onMover).toHaveBeenCalledWith("esquerda");
    fireEvent.click(screen.getByLabelText("Apagar Entregue"));
    expect(onMarcar).toHaveBeenCalled();
  });
});

describe("o teto do nome de coluna", () => {
  it("⚠️ o campo de RENOMEAR tem maxLength 60, como o de criar", () => {
    // Renomear passa pelo LOTE, e no lote a recusa do servidor (422) perde a
    // edição INTEIRA, não só a coluna que passou do teto.
    montar({ ref: "c1", nome: "Backlog", semantic: "OPEN" });
    fireEvent.click(screen.getByText("Backlog"));
    const campo = screen.getByLabelText("Nome da coluna Backlog");
    expect(campo.getAttribute("maxLength")).toBe("60");
  });
});

describe("o selo padrão é o controle do alvo", () => {
  it("⚠️ na coluna que JÁ é o alvo, o selo NÃO é botão", () => {
    // ⚠️ Não existe desmarcar -- um clique que não faz nada é pior que um
    // texto que não clica. Sem alvo, `OPEN` e `DONE` fazem toda criação de
    // tarefa naquele quadro devolver 422, dias depois, para outra pessoa.
    montar({ ref: "c1", nome: "Backlog", semantic: "OPEN", alvo: true });
    expect(screen.getByText("padrão")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Tornar Backlog/ })).toBeNull();
  });

  it("⚠️ na que NÃO é, aparece o convite -- e ele chama `onTornarAlvo`", () => {
    const { onTornarAlvo } = montar({
      ref: "c2",
      nome: "Ideias",
      semantic: "OPEN",
      alvo: false,
    });
    fireEvent.click(screen.getByRole("button", { name: /Tornar Ideias/ }));
    expect(onTornarAlvo).toHaveBeenCalled();
  });

  it("o padrão PEDIDO tem o × de desfazer; o salvo não", () => {
    const onDesfazerAlvo = vi.fn();
    montar({ ref: "c2", nome: "Ideias", semantic: "OPEN", alvo: true, alvoPedido: true }, { onDesfazerAlvo });
    fireEvent.click(screen.getByRole("button", { name: /Desfazer: Ideias deixa de ser/ }));
    expect(onDesfazerAlvo).toHaveBeenCalled();
    cleanup();
    montar({ ref: "c1", nome: "Backlog", semantic: "OPEN", alvo: true, alvoPedido: false }, { onDesfazerAlvo });
    expect(screen.queryByRole("button", { name: /Desfazer/ })).toBeNull();
  });

  it("⚠️ coluna NOVA não pode virar alvo", () => {
    // Ela não tem id, e o backend aplica o alvo numa etapa que roda antes de
    // criar. `comAlvo` recusa `tmp:`; aqui a tela nem oferece.
    montar({ ref: "tmp:1", nome: "Ideias", semantic: "OPEN", nova: true });
    expect(screen.queryByRole("button", { name: /Tornar Ideias/ })).toBeNull();
  });

  it("⚠️ coluna marcada para APAGAR não oferece virar alvo", () => {
    // Dois gestos contraditórios no mesmo lote. O `comAlvo` até desfaz a
    // exclusão, mas oferecer isso na tela seria confuso.
    montar({ ref: "c2", nome: "Ideias", semantic: "OPEN", apagada: true });
    expect(screen.queryByRole("button", { name: /Tornar Ideias/ })).toBeNull();
  });
});

// Cobrar prazo no modo de edição: é a única rota que escreve `notify_deadline`.
describe("CabecalhoDeColunaEditavel -- cobrar prazo", () => {
  it("o sino diz o estado por `aria-pressed`, e não pela cor", () => {
    // ⚠️ COR SOZINHA NÃO É ESTADO. Um sino cinza-claro contra um cinza-médio
    // não diz nada a quem não distingue os dois, e o `web/AGENTS.md` proíbe
    // informação só por cor.
    montar({ nome: "Backlog", avisaPrazo: true });
    expect(
      screen
        .getByLabelText("Cobrar prazo na coluna Backlog")
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("clicar manda o valor DESTINO, e não um alternar", () => {
    // ⚠️ Mandar "inverte aí" faria dois cliques rápidos lerem o mesmo estado
    // velho e acabarem no valor errado. Quem sabe o atual é a linha.
    const { onAvisar } = montar({ avisaPrazo: true });
    fireEvent.click(screen.getByLabelText(/Cobrar prazo na coluna/));
    expect(onAvisar).toHaveBeenCalledWith(false);
  });

  it("⚠️ coluna TERMINAL não tem o controle -- lá a flag é ignorada", () => {
    // O backend ignora `notify_deadline` em DONE e CANCELLED;
    // mostrar o sino prometeria um efeito que não existe.
    montar({ semantic: "DONE" });
    expect(screen.queryByLabelText(/Cobrar prazo na coluna/)).toBeNull();
  });

  it("coluna marcada para APAGAR não tem o controle", () => {
    // Mexer na flag de uma coluna que sai no mesmo lote é gesto sem efeito --
    // o `paraLote` inclusive filtra antes de mandar.
    montar({ apagada: true });
    expect(screen.queryByLabelText(/Cobrar prazo na coluna/)).toBeNull();
  });
});
