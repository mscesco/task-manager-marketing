/**
 * Spec 050, fatia C -- a fileira e o seletor, por render.
 *
 * A fronteira da Spec 027: a REGRA esta em `lib/reacoes.ts` (e tem teste
 * proprio); aqui so o desenho e o gesto -- o que o clique dispara, o que
 * aparece marcado, e o que o teclado alcanca.
 *
 * ⚠️ `fireEvent`, e nao `user-event`: o projeto nao tem essa dependencia, e os
 * testes de componente que existem (Board, TaskDetail) usam `fireEvent`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import FileiraDeReacoes from "../FileiraDeReacoes";
import SeletorDeReacao from "../SeletorDeReacao";

// ⚠️ Sem `globals: true` no vitest, o auto-cleanup nao se registra
// (web/AGENTS.md §11).
afterEach(cleanup);

const EU = "user-eu";
const ANA = "user-ana";
const MEMBROS = new Map([
  [EU, { name: "Camila" }],
  [ANA, { name: "Ana" }],
]);

const REACTIONS = [
  { emoji: "👍", user_ids: [ANA, EU] },
  { emoji: "🎉", user_ids: [ANA] },
];

function abrirSeletor() {
  fireEvent.click(screen.getByLabelText("Reagir ao comentário"));
}

describe("FileiraDeReacoes", () => {
  it("mostra uma pilula por emoji, com a contagem", () => {
    render(
      <FileiraDeReacoes
        reactions={REACTIONS}
        membros={MEMBROS}
        meuId={EU}
        onAlternar={() => {}}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByLabelText(/👍, 2/)).toBeDefined();
  });

  it("⚠️ a minha pilula diz 'você reagiu' -- e nao so a cor", () => {
    render(
      <FileiraDeReacoes
        reactions={REACTIONS}
        membros={MEMBROS}
        meuId={EU}
        onAlternar={() => {}}
      />,
    );
    expect(screen.getByLabelText(/você reagiu/)).toBeDefined();
    expect(
      screen.getByLabelText(/🎉, 1: Ana — clique para reagir/),
    ).toBeDefined();
  });

  it("nomeia quem reagiu, com 'você' por ultimo", () => {
    render(
      <FileiraDeReacoes
        reactions={REACTIONS}
        membros={MEMBROS}
        meuId={EU}
        onAlternar={() => {}}
      />,
    );
    expect(screen.getByLabelText(/Ana e você/)).toBeDefined();
  });

  it("clicar avisa o pai com o emoji", () => {
    const onAlternar = vi.fn();
    render(
      <FileiraDeReacoes
        reactions={REACTIONS}
        membros={MEMBROS}
        meuId={EU}
        onAlternar={onAlternar}
      />,
    );
    fireEvent.click(screen.getByLabelText(/🎉/));
    expect(onAlternar).toHaveBeenCalledWith("🎉");
  });

  it("sem reacao, nao desenha pilula nenhuma", () => {
    // ⚠️ O conteiner EXISTE vazio (`empty:hidden`), e e de proposito: sem ele
    // a ultima pilula a sair era desmontada junto e nunca animava a saida.
    render(
      <FileiraDeReacoes
        reactions={[]}
        membros={MEMBROS}
        meuId={EU}
        onAlternar={() => {}}
      />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("uma reacao nova aparece na fileira que ja estava na tela", () => {
    const { rerender } = render(
      <FileiraDeReacoes
        reactions={[]}
        membros={MEMBROS}
        meuId={EU}
        onAlternar={() => {}}
      />,
    );
    rerender(
      <FileiraDeReacoes
        reactions={[{ emoji: "🎉", user_ids: [ANA] }]}
        membros={MEMBROS}
        meuId={EU}
        onAlternar={() => {}}
      />,
    );
    expect(screen.getByLabelText(/🎉, 1: Ana/)).toBeDefined();
  });

  it("a contagem muda sem trocar a pilula de lugar", () => {
    const { rerender } = render(
      <FileiraDeReacoes
        reactions={REACTIONS}
        membros={MEMBROS}
        meuId={EU}
        onAlternar={() => {}}
      />,
    );
    rerender(
      <FileiraDeReacoes
        reactions={[
          { emoji: "👍", user_ids: [ANA, EU, "outro"] },
          { emoji: "🎉", user_ids: [ANA] },
        ]}
        membros={MEMBROS}
        meuId={EU}
        onAlternar={() => {}}
      />,
    );
    const pilulas = screen.getAllByRole("button");
    expect(pilulas[0].getAttribute("aria-label")).toMatch(/^👍, 3/);
    expect(pilulas[1].getAttribute("aria-label")).toMatch(/^🎉, 1/);
  });
});

describe("SeletorDeReacao", () => {
  it("a bolinha tem nome acessivel e abre o seletor", () => {
    render(<SeletorDeReacao onEscolher={() => {}} />);
    const bolinha = screen.getByLabelText("Reagir ao comentário");
    expect(bolinha.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(bolinha);
    expect(bolinha.getAttribute("aria-expanded")).toBe("true");
    // os dois sugeridos, na ordem pedida por ela
    expect(screen.getByLabelText("Reagir com 👍")).toBeDefined();
    expect(screen.getByLabelText("Reagir com ❤️")).toBeDefined();
  });

  // ⚠️ `waitFor` nos testes de FECHAR: o painel sai com animacao
  // (`AnimatePresence`), e fica no DOM ate ela terminar.
  it("escolher um sugerido avisa o pai e fecha", async () => {
    const onEscolher = vi.fn();
    render(<SeletorDeReacao onEscolher={onEscolher} />);
    abrirSeletor();
    fireEvent.click(screen.getByLabelText("Reagir com 👍"));
    expect(onEscolher).toHaveBeenCalledWith("👍");
    await waitFor(() =>
      expect(screen.queryByLabelText("Buscar emoji")).toBeNull(),
    );
  });

  it("⚠️ a busca e em portugues: 'joia' acha o polegar", () => {
    const onEscolher = vi.fn();
    render(<SeletorDeReacao onEscolher={onEscolher} />);
    abrirSeletor();
    fireEvent.change(screen.getByLabelText("Buscar emoji"), {
      target: { value: "joia" },
    });
    fireEvent.click(screen.getByLabelText("polegar para cima"));
    expect(onEscolher).toHaveBeenCalledWith("👍");
  });

  it("busca sem resultado avisa, em vez de ficar vazia", () => {
    render(<SeletorDeReacao onEscolher={() => {}} />);
    abrirSeletor();
    fireEvent.change(screen.getByLabelText("Buscar emoji"), {
      target: { value: "zzzzz" },
    });
    expect(screen.getByText(/Nenhum emoji/)).toBeDefined();
  });

  it("a aba de grupo troca a grade -- e diz o nome do grupo", () => {
    render(<SeletorDeReacao onEscolher={() => {}} />);
    abrirSeletor();
    // A aba desenha um emoji, mas o nome do grupo esta no rotulo.
    fireEvent.click(screen.getByRole("tab", { name: "pessoas e corpo" }));
    expect(
      screen.getByRole("tab", { name: "pessoas e corpo" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByLabelText("polegar para cima")).toBeDefined();
  });

  it("reabrir comeca com a busca vazia", async () => {
    // ⚠️ Este teste NAO afirma nada sobre o conteudo durante a saida: o
    // `AnimatePresence` congela o painel que sai, e um teste sobre isso
    // testaria a biblioteca, e nao este componente.
    render(<SeletorDeReacao onEscolher={() => {}} />);
    abrirSeletor();
    fireEvent.change(screen.getByLabelText("Buscar emoji"), {
      target: { value: "joia" },
    });
    fireEvent.keyDown(screen.getByLabelText("Buscar emoji"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByLabelText("Buscar emoji")).toBeNull(),
    );

    abrirSeletor();
    expect(
      (screen.getByLabelText("Buscar emoji") as HTMLInputElement).value,
    ).toBe("");
  });

  it("Escape fecha o seletor", async () => {
    render(<SeletorDeReacao onEscolher={() => {}} />);
    abrirSeletor();
    fireEvent.keyDown(screen.getByLabelText("Buscar emoji"), {
      key: "Escape",
    });
    await waitFor(() =>
      expect(screen.queryByLabelText("Buscar emoji")).toBeNull(),
    );
  });

  it("⚠️ rolar a GRADE nao fecha o seletor -- rolar e o gesto principal ali", () => {
    // O `AnchoredPanel` fechava a qualquer rolagem, inclusive a de dentro
    // dele. Com uma grade de emojis, isso fechava o painel na cara de quem
    // rolava.
    render(<SeletorDeReacao onEscolher={() => {}} />);
    abrirSeletor();
    fireEvent.scroll(screen.getByRole("group", { name: "Emojis" }));
    // ⚠️ O ESTADO DO GATILHO, e nao "o campo de busca ainda existe": fechado,
    // o painel CONTINUA no DOM durante a animacao de saida, e a versao
    // anterior deste teste passava com a trava removida (sabotagem 050D).
    expect(
      screen.getByLabelText("Reagir ao comentário").getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("⚠️ abre alinhado pela DIREITA do botao -- para dentro do detalhe", () => {
    // Pedido dela em 16/09, com captura: o botao fica no canto direito da
    // linha, e o painel alinhado pela esquerda saia para fora do detalhe.
    const antes = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({ top: 100, bottom: 126, left: 574, right: 600, width: 26, height: 26 }) as DOMRect;
    try {
      render(<SeletorDeReacao onEscolher={() => {}} />);
      abrirSeletor();
      const painel = screen.getByRole("dialog", { name: "Escolher reação" });
      // borda direita do painel (288px) encosta na do botao: 600 - 288 = 312
      expect(painel.style.left).toBe("312px");
      expect(painel.style.transformOrigin).toBe("top right");
    } finally {
      HTMLElement.prototype.getBoundingClientRect = antes;
    }
  });

  it("rolar FORA do seletor fecha -- a medida do gatilho envelheceu", async () => {
    render(<SeletorDeReacao onEscolher={() => {}} />);
    abrirSeletor();
    fireEvent.scroll(window);
    await waitFor(() =>
      expect(screen.queryByLabelText("Buscar emoji")).toBeNull(),
    );
  });

  it("⚠️ um grupo por vez -- a grade nao desenha o catalogo inteiro", () => {
    render(<SeletorDeReacao onEscolher={() => {}} />);
    abrirSeletor();
    // 1.914 emojis no catalogo; a grade do primeiro grupo e uma fracao disso.
    expect(screen.getAllByRole("button").length).toBeLessThan(400);
  });
});
