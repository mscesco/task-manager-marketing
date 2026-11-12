// As abas e o alternador.
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
//   - no alternador, a pastilha é UM nó só, que sobrevive à troca, e o que
//     muda é o `justify-content` do contêiner. É a diferença entre `layout` e
//     `layoutId`, e as duas quebras possíveis são silenciosas: a animação
//     simplesmente para, e nada acusa.
//
// Armadilha: `{aba.contagem && …}` NÃO cai aqui. `0 && x` dá `0` e o React
// renderiza o zero solto, sem o `<span>`; o texto continua lá. Prender a FORMA
// do número exige afirmar sobre o elemento.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import Tabs from "@/components/Tabs";
import Toggle from "@/components/Toggle";

afterEach(cleanup);

const ABAS = [
  { id: "ativo", label: "Ativos", count: 5 },
  { id: "convidado", label: "Convidados", count: 0 },
  { id: "inativo", label: "Inativos" },
] as const;

describe("Tabs", () => {
  it("marca `aria-selected` só na aba ativa", () => {
    render(
      <Tabs
        aria-label="Estado"
        tabs={ABAS}
        active="convidado"
        onSelect={() => {}}
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
      <Tabs aria-label="Estado" tabs={ABAS} active="ativo" onSelect={() => {}} />,
    );
    expect(
      screen.getByRole("tab", { name: /Convidados/ }).textContent,
    ).toContain("0");
  });

  it("`contagem` ausente não inventa número", () => {
    render(
      <Tabs aria-label="Estado" tabs={ABAS} active="ativo" onSelect={() => {}} />,
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
      <Tabs aria-label="Estado" tabs={ABAS} active="ativo" onSelect={escolher} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Convidados/ }));
    expect(escolher).toHaveBeenCalledWith("convidado");
  });

  it("o grupo é anunciado com o próprio nome", () => {
    // ⚠️ Sem o `aria-label` no `tablist`, quem usa leitor de tela ouve "grupo
    // de abas" e não sabe DE QUE são as abas -- e esta tela tem duas fileiras.
    render(
      <Tabs aria-label="Estado" tabs={ABAS} active="ativo" onSelect={() => {}} />,
    );
    expect(screen.getByRole("tablist", { name: "Estado" })).toBeTruthy();
  });
});

describe("Toggle", () => {
  const LADOS = [
    { id: "membros", label: "Membros", count: 8 },
    { id: "subtimes", label: "Subtimes", count: 7 },
  ] as const;

  it("marca `aria-selected` no lado ativo", () => {
    render(
      <Toggle
        aria-label="O que ver"
        sides={LADOS}
        active="subtimes"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain(
      "Subtimes",
    );
  });

  it("⭐ a pastilha é UM elemento só, montado desde o início", () => {
    // ⚠️⚠️ É a diferença entre `layout` e `layoutId`.
    // Com `layoutId` haveria uma instância por lado, montada e desmontada a
    // cada clique; aqui há UMA, e ela ANDA. O teste prende isso pela via que
    // o jsdom permite: a mesma pastilha existe nos dois estados, e é filha
    // direta do contêiner (se virasse `absolute` dentro de um botão, o
    // `justify-content` deixaria de movê-la e a animação sumiria em silêncio).
    const { rerender } = render(
      <Toggle
        aria-label="O que ver"
        sides={LADOS}
        active="membros"
        onSelect={() => {}}
      />,
    );
    const grupo = screen.getByRole("tablist");
    const emFluxo = () =>
      [...grupo.children].filter((c) => !c.className.includes("absolute"));

    expect(emFluxo()).toHaveLength(1);
    const pastilha = emFluxo()[0];

    rerender(
      <Toggle
        aria-label="O que ver"
        sides={LADOS}
        active="subtimes"
        onSelect={() => {}}
      />,
    );
    // O MESMO nó do DOM, e não um substituto.
    expect(emFluxo()[0]).toBe(pastilha);
  });

  it("⭐ é o `justify-content` que muda — não há outra fonte de movimento", () => {
    // ⚠️ Se alguém trocar isto por `left`/`transform` na mão, o `layout` do
    // motion fica sem nada para observar e a pastilha para de deslizar. O
    // jsdom não mede posições, mas ESTA propriedade ele guarda.
    const { rerender } = render(
      <Toggle
        aria-label="O que ver"
        sides={LADOS}
        active="membros"
        onSelect={() => {}}
      />,
    );
    const grupo = screen.getByRole("tablist") as HTMLElement;
    expect(grupo.style.justifyContent).toBe("flex-start");

    rerender(
      <Toggle
        aria-label="O que ver"
        sides={LADOS}
        active="subtimes"
        onSelect={() => {}}
      />,
    );
    expect(grupo.style.justifyContent).toBe("flex-end");
  });

  it("o clique devolve o id do lado", () => {
    const escolher = vi.fn();
    render(
      <Toggle
        aria-label="O que ver"
        sides={LADOS}
        active="membros"
        onSelect={escolher}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Subtimes/ }));
    expect(escolher).toHaveBeenCalledWith("subtimes");
  });
});
