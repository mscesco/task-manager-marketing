// =====================================================
// components/__tests__/BloqueioAlcance.test.tsx -- Spec 037, E8
// -----------------------------------------------------
// O QUE ESTES TESTES PROTEGEM, e que `tsc` e `next build` NAO pegam:
//
//   - que cada tarefa vire um LINK, com o href certo. Sem link, a lista e uma
//     lista de nomes: a pessoa sabe o que a barrou e nao chega la;
//   - que o link abra em ABA NOVA. Na mesma aba, cada reatribuicao desmonta a
//     tela de membros e a pessoa recomeca -- 32 vezes, no caso medido;
//   - que subtime/coluna ausentes nao virem lixo na tela.
//
// ⚠️ `afterEach(cleanup)` EXPLICITO. O `vitest.config.ts` roda sem
// `globals: true`, entao o auto-cleanup do @testing-library nao se registra
// sozinho e o segundo render encontra o primeiro ainda no documento.
//
// SABOTAGEM (executar antes de commitar):
//     Em `components/BloqueioAlcance.tsx`, trocar o `<a href=...>` inteiro
//     pelo texto solto `{t.titulo}` -- reverte a decisao de a lista ser
//     acionavel, nao a mutila.
//     Devem cair `cada tarefa e um link para /tarefa/<id>` e `o link abre em
//     aba nova`. NAO deve cair `mostra o titulo de cada tarefa`, que passa a
//     ser a unica coisa que sobra -- e e exatamente por isso que ele nao
//     basta sozinho.
// =====================================================
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import BloqueioAlcance from "@/components/BloqueioAlcance";
import type { BloqueioDeAlcance } from "@/lib/erroAlcance";

afterEach(cleanup);

const BLOQUEIO: BloqueioDeAlcance = {
  mensagem: "Esta pessoa é a única responsável por tarefas.",
  acao: "move_member_subteam",
  tarefas: [
    { id: "t-1", titulo: "Revisar pauta de agosto", subtime: "SEO", coluna: "Em andamento" },
    { id: "t-2", titulo: "Briefing do carrossel", subtime: "SEO", coluna: "A fazer" },
  ],
};

describe("<BloqueioAlcance />", () => {
  it("mostra o titulo da acao que foi barrada", () => {
    render(<BloqueioAlcance bloqueio={BLOQUEIO} />);

    expect(screen.getByText("Não dá para mover ainda")).toBeTruthy();
  });

  it("mostra a mensagem do backend", () => {
    render(<BloqueioAlcance bloqueio={BLOQUEIO} />);

    expect(
      screen.getByText("Esta pessoa é a única responsável por tarefas.")
    ).toBeTruthy();
  });

  it("mostra o titulo de cada tarefa", () => {
    render(<BloqueioAlcance bloqueio={BLOQUEIO} />);

    expect(screen.getByText("Revisar pauta de agosto")).toBeTruthy();
    expect(screen.getByText("Briefing do carrossel")).toBeTruthy();
  });

  it("cada tarefa e um link para /tarefa/<id>", () => {
    render(<BloqueioAlcance bloqueio={BLOQUEIO} />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/tarefa/t-1",
      "/tarefa/t-2",
    ]);
  });

  it("o link abre em aba nova (nao desmonta a tela de membros)", () => {
    render(<BloqueioAlcance bloqueio={BLOQUEIO} />);

    for (const a of screen.getAllByRole("link")) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toContain("noreferrer");
    }
  });

  it("mostra subtime e coluna como contexto", () => {
    render(<BloqueioAlcance bloqueio={BLOQUEIO} />);

    expect(screen.getByText(/SEO · Em andamento/)).toBeTruthy();
  });

  it("nao inventa contexto quando subtime e coluna sao nulos", () => {
    render(
      <BloqueioAlcance
        bloqueio={{
          mensagem: "Barrado.",
          acao: null,
          tarefas: [{ id: "t-9", titulo: "Avulsa", subtime: null, coluna: null }],
        }}
      />
    );

    expect(screen.getByText("Avulsa")).toBeTruthy();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it("concorda no singular com uma tarefa so", () => {
    render(
      <BloqueioAlcance
        bloqueio={{ ...BLOQUEIO, tarefas: [BLOQUEIO.tarefas[0]] }}
      />
    );

    expect(screen.getByText("1 tarefa precisa de outro responsável antes:")).toBeTruthy();
  });

  it("mostra a contagem no plural", () => {
    render(<BloqueioAlcance bloqueio={BLOQUEIO} />);

    expect(screen.getByText("2 tarefas precisam de outro responsável antes:")).toBeTruthy();
  });
});
