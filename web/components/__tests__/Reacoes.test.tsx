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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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

  it("sem reacao, nao desenha nada", () => {
    const { container } = render(
      <FileiraDeReacoes
        reactions={[]}
        membros={MEMBROS}
        meuId={EU}
        onAlternar={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
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

  it("escolher um sugerido avisa o pai e fecha", () => {
    const onEscolher = vi.fn();
    render(<SeletorDeReacao onEscolher={onEscolher} />);
    abrirSeletor();
    fireEvent.click(screen.getByLabelText("Reagir com 👍"));
    expect(onEscolher).toHaveBeenCalledWith("👍");
    expect(screen.queryByLabelText("Buscar emoji")).toBeNull();
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

  it("Escape fecha o seletor", () => {
    render(<SeletorDeReacao onEscolher={() => {}} />);
    abrirSeletor();
    fireEvent.keyDown(screen.getByLabelText("Buscar emoji"), {
      key: "Escape",
    });
    expect(screen.queryByLabelText("Buscar emoji")).toBeNull();
  });

  it("⚠️ um grupo por vez -- a grade nao desenha o catalogo inteiro", () => {
    render(<SeletorDeReacao onEscolher={() => {}} />);
    abrirSeletor();
    // 1.914 emojis no catalogo; a grade do primeiro grupo e uma fracao disso.
    expect(screen.getAllByRole("button").length).toBeLessThan(400);
  });
});
