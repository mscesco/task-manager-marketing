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
    impedimento: null,
    // Spec 039 (F9). O default do produto: coluna cobra prazo.
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

  it("cria com nome e tipo -- e, sem escolher, cor `undefined` e prazo cobrado", () => {
    const { onCriar } = montarForm();
    fireEvent.change(screen.getByLabelText("Nome da coluna"), {
      target: { value: "Aguardando cliente" },
    });
    fireEvent.change(screen.getByLabelText("Tipo"), {
      target: { value: "DONE" },
    });
    fireEvent.click(screen.getByText("Criar"));
    // ⚠️ `undefined` E NAO uma cor concreta: e "a rotacao do backend decide",
    // que e como toda coluna nasceu ate 22/08. Um default concreto aqui faria
    // a tela decidir o que e do servidor -- e todas as colunas novas sairiam
    // da mesma cor.
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

  // =====================================================================
  // Spec 039, F9 -- a cor e a cobrança de prazo.
  //
  // ⚠️ AQUI MORAVA O TESTE "NÃO tem campo de cor", e ele caiu em 22/08 fazendo
  // exatamente o que prometia. O comentário dele dizia: "se este teste ficar
  // vermelho, alguém trouxe a fatia para dentro sem passar pelo plano". Desta
  // vez a fatia PASSOU pelo plano -- a Camila decidiu "os 8 tokens agora, roda
  // RGB depois" --, então ele foi substituído em vez de apagado, e o que ele
  // guardava continua guardado: hex livre segue fora.
  // =====================================================================

  it("⚠️ a cor sai de uma PALETA de tokens -- não há campo de hex", () => {
    // O que o teste antigo protegia continua valendo: `<input type="color">`
    // devolveria hex, e hex não inverte no tema escuro (Spec 031, C1a). A roda
    // RGB é fatia própria porque obriga a derivar a cor do texto por
    // luminância.
    montarForm();
    expect(document.querySelector('input[type="color"]')).toBeNull();
    expect(
      screen.getByRole("radiogroup", { name: "Cor" }),
    ).toBeTruthy();
    // Os oito tentos mais a opção "Automática".
    expect(screen.getAllByRole("radio").length).toBe(9);
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
    // ⚠️ ESTE É O "AGUARDANDO CLIENTE" QUE A ADR 0030 PROMETEU e o produto não
    // entregava: até 22/08 o campo não tinha escritor nenhum, e a coluna
    // nascia cobrando prazo.
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
    // §7.3, item 3. Em Concluído e Cancelado o backend IGNORA a flag; deixar a
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
    // ⚠️ DESDE 17/08 A COLUNA CRIADA APARECE NO QUADRO, para poder ser
    // posicionada no mesmo gesto em que nasce. Sem este selo ela fica
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
    // trata os dois casos). O cabeçalho não precisa saber a diferença -- mas
    // se o "×" ou as setas sumissem para ela, o pedido de 17/08 morreria pela
    // metade: apareceria na tela e não daria para mexer.
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

describe("o teto do nome de coluna (18/08)", () => {
  it("⚠️ o campo de RENOMEAR tem maxLength 60 -- faltava, e criar sempre teve", () => {
    // ⚠️ POR QUE ISTO IMPORTA: renomear passa pelo LOTE, e no lote a recusa
    // perde a edição INTEIRA. Sem este atributo, renomear três colunas com uma
    // passando do teto perdia as três -- e o 422 do servidor era a primeira
    // notícia. Mesmo motivo de `nomeDeQuadroValido` existir no front.
    montar({ ref: "c1", nome: "Backlog", semantic: "OPEN" });
    fireEvent.click(screen.getByText("Backlog"));
    const campo = screen.getByLabelText("Nome da coluna Backlog");
    expect(campo.getAttribute("maxLength")).toBe("60");
  });
});

describe("o selo padrão virou o controle (Spec 036, fatia 12)", () => {
  it("⚠️ na coluna que JÁ é o alvo, o selo NÃO é botão", () => {
    // ⚠️ Não existe desmarcar -- um clique que não faz nada é pior que um
    // texto que não clica. Sem alvo, `OPEN` e `DONE` fazem toda criação de
    // tarefa naquele quadro devolver 422, dias depois, para outra pessoa.
    montar({ ref: "c1", nome: "Backlog", semantic: "OPEN", alvo: true });
    expect(screen.getByText("padrão")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Tornar Backlog/ })).toBeNull();
  });

  it("⚠️ na que NÃO é, aparece o convite -- e ele chama `onTornarAlvo`", () => {
    // ⚠️ Até a fatia 12 o selo era só texto, e isso tinha custo escrito no
    // `plan.md`: ele "anuncia que existe uma coluna escolhida e não oferece
    // como trocá-la". A resposta era "apague o quadro e recomece".
    const { onTornarAlvo } = montar({
      ref: "c2",
      nome: "Ideias",
      semantic: "OPEN",
      alvo: false,
    });
    fireEvent.click(screen.getByRole("button", { name: /Tornar Ideias/ }));
    expect(onTornarAlvo).toHaveBeenCalled();
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

// =====================================================================
// Spec 039, F9 (§7.3, item 2) -- cobrar prazo, no modo de edição.
//
// ⚠️ ESTE CONTROLE EXISTE PARA AS 8 COLUNAS DE PRODUÇÃO. Elas nasceram antes
// de o campo ter escritor, e até 22/08 a única forma de mudar era SQL no
// Adminer -- o `notify_deadline` era lido pelo serviço de notificação e
// exposto na API, mas nenhuma rota escrevia nele.
// =====================================================================
describe("CabecalhoDeColunaEditavel -- cobrar prazo (F9)", () => {
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
    // §7.3, item 3. O backend ignora `notify_deadline` em DONE e CANCELLED;
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
