// Spec 047, revisão de 09/09 -- as abas e o alternador.
//
// ⚠️ O QUE ELE **NÃO** COBRE: a animação. O `layoutId` do motion mede
// posições reais, e o jsdom não tem layout -- toda medida é zero. Testar
// "deslizou" aqui seria testar o mock, não o produto. O que dá para prender é
// o que quebra em silêncio e ninguém vê até a tela estar na mão de alguém.
//
// O que ELE prende:
//   - `aria-selected` segue a aba ativa (sem isso o leitor de tela não diz
//     onde a pessoa está, e nada na tela acusa);
//   - `contagem: 0` MOSTRA "0", e `undefined` não mostra nada -- uma aba sem
//     número lê-se como "não sei", e "0" é uma resposta;
//   - o clique devolve o id, e não o índice nem o rótulo;
//   - as duas variantes marcam papéis de acessibilidade iguais, porque a
//     diferença entre elas é só de forma.
//
// SABOTAGENS medidas:
//   A. Trocar `contagem !== undefined` por um ternário sobre a verdade
//      (`contagem ? … : null`). **Cai 1**: "mostra 0". MEDIDO.
//   B. Tirar o `aria-selected`. **Cai 2**.
//
// ⚠️ E uma que eu previa e NÃO cai, o que vale mais registrar do que as que
// caem: trocar por `{aba.contagem && …}`. Parece o erro clássico do `0`
// falsy, mas `0 && x` avalia para `0` e o React RENDERIZA o zero -- solto,
// sem o `<span>`, e portanto sem o espaçamento e o tom apagado. O texto
// continua lá, então nenhuma asserção de conteúdo pega. Quem quiser prender
// a FORMA do número precisa afirmar sobre o elemento, não sobre o texto.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import Abas from "@/components/Abas";

afterEach(cleanup);

const ABAS = [
  { id: "ativo", rotulo: "Ativos", contagem: 5 },
  { id: "convidado", rotulo: "Convidados", contagem: 0 },
  { id: "inativo", rotulo: "Inativos" },
] as const;

describe("Abas", () => {
  it("marca `aria-selected` só na aba ativa", () => {
    render(
      <Abas
        aria-label="Estado"
        abas={ABAS}
        ativa="convidado"
        onEscolher={() => {}}
      />,
    );
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain(
      "Convidados",
    );
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("⭐ `contagem: 0` MOSTRA o zero", () => {
    // ⚠️ Uma aba sem número lê-se como "não sei quantos"; "0" é uma resposta,
    // e é justamente na aba vazia que ele mais informa -- "Convidados 0" diz
    // que ninguém está pendente, sem precisar clicar.
    //
    // ⚠️ O guarda tem de ser `!== undefined`. Qualquer teste de verdade
    // (`contagem ? …`, `contagem > 0 && …`) apaga o zero.
    render(
      <Abas aria-label="Estado" abas={ABAS} ativa="ativo" onEscolher={() => {}} />,
    );
    expect(
      screen.getByRole("tab", { name: /Convidados/ }).textContent,
    ).toContain("0");
  });

  it("`contagem` ausente não inventa número", () => {
    render(
      <Abas aria-label="Estado" abas={ABAS} ativa="ativo" onEscolher={() => {}} />,
    );
    expect(screen.getByRole("tab", { name: /Inativos/ }).textContent).toBe(
      "Inativos",
    );
  });

  it("o clique devolve o ID, e não o rótulo", () => {
    // ⚠️ Aqui o `tsc` AJUDA -- `T` é a união dos ids literais, então passar
    // `aba.rotulo` (um `string` qualquer) não compila. O teste prende o resto:
    // devolver o índice, a aba errada, ou nada.
    const escolher = vi.fn();
    render(
      <Abas aria-label="Estado" abas={ABAS} ativa="ativo" onEscolher={escolher} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Convidados/ }));
    expect(escolher).toHaveBeenCalledWith("convidado");
  });

  it("a variante pílula é a mesma coisa para quem usa leitor de tela", () => {
    // ⚠️ A diferença entre as duas é de FORMA (moldura x régua). Se a variante
    // mudasse os papéis, o alternador deixaria de ser anunciado como grupo.
    render(
      <Abas
        aria-label="O que ver"
        variante="pilula"
        abas={[
          { id: "membros", rotulo: "Membros", contagem: 8 },
          { id: "subtimes", rotulo: "Subtimes", contagem: 7 },
        ]}
        ativa="subtimes"
        onEscolher={() => {}}
      />,
    );
    expect(screen.getByRole("tablist", { name: "O que ver" })).toBeTruthy();
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain(
      "Subtimes",
    );
  });
});
