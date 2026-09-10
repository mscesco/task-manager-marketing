// Spec 047, revisão de 10/09 -- o contorno desenhado, agora do produto inteiro.
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE: o contorno deixou de ser detalhe do cartão de
// subtime e virou a affordance de clique de sete superfícies, no lugar do anel
// duro que saiu do `globals.css`. Um erro nele não dá tela vermelha -- ele
// rouba um clique, ou aparece no leitor de tela como conteúdo.
//
// ⚠️ O QUE ELE **NÃO** COBRE, e não tem como: a FORMA do traço. Em jsdom
// `offsetWidth` é 0, então o `<svg>` (que só nasce com largura > 0) nunca
// monta. Se o traço passar por fora do canto ou a volta ficar torta, quem pega
// é o olho -- entra no smoke, como a spec §7 já diz de classe CSS.
//
// SABOTAGENS medidas -- ver o fim do arquivo.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import AnimatedOutline, { useDrawnOutline } from "@/components/AnimatedOutline";

afterEach(cleanup);

/** Uma superfície qualquer, montada como as sete reais montam. */
function Superficie({ onClick }: { onClick: () => void }) {
  const { alvo, outline } = useDrawnOutline(8);
  return (
    <button className="relative" onClick={onClick} {...alvo}>
      {outline}
      Abrir a área
    </button>
  );
}

describe("AnimatedOutline", () => {
  it("⚠️ é DECORAÇÃO: não aparece na árvore de acessibilidade", () => {
    // ⚠️ Sem `aria-hidden`, um leitor de tela anunciaria um nó vazio no meio de
    // cada cartão clicável do produto.
    const { container } = render(<AnimatedOutline show radius={8} />);
    const camada = container.firstElementChild;
    expect(camada?.getAttribute("aria-hidden")).toBe("true");
  });

  it("⚠️⚠️ é um <span>, e não um <div> -- ele vive dentro de <button>", () => {
    // ⚠️ `<div>` dentro de `<button>` é HTML inválido, e o navegador desfaz o
    // aninhamento por conta própria -- o mesmo mecanismo que quebraria um
    // `<button>` dentro de `<a>`. Quatro das sete superfícies são `<button>`.
    const { container } = render(<AnimatedOutline show radius={8} />);
    expect(container.firstElementChild?.tagName).toBe("SPAN");
  });

  it("⚠️⚠️ NÃO ROUBA O CLIQUE da superfície que ele contorna", () => {
    // ⚠️ Ele é `absolute inset-0`: cobre o alvo inteiro. Sem
    // `pointer-events: none` ele receberia todo clique no cartão, e o cartão
    // pararia de abrir -- num componente usado em sete telas.
    const abriu = vi.fn();
    render(<Superficie onClick={abriu} />);
    fireEvent.click(screen.getByRole("button", { name: /Abrir a área/ }));
    expect(abriu).toHaveBeenCalledTimes(1);
  });

  it("a camada declara `pointer-events-none`", () => {
    // O teste acima passa em jsdom mesmo sem a classe (jsdom não faz layout,
    // então o clique vai direto ao botão). Este prende a causa.
    const { container } = render(<AnimatedOutline show radius={8} />);
    expect(container.firstElementChild?.className).toContain(
      "pointer-events-none",
    );
  });

  it("useDrawnOutline entrega os QUATRO gatilhos -- hover E foco", () => {
    // ⚠️ Os dois pares, e não só o mouse: o cartão de subtime acende no hover
    // DO CARTÃO e no foco DO LINK, e atender só um deixaria o teclado sem
    // destaque -- que é exatamente o que o `:focus-visible` do CSS fazia de
    // graça antes de o contorno o substituir nas superfícies.
    function Sonda() {
      const { alvo } = useDrawnOutline();
      return <span data-testid="chaves">{Object.keys(alvo).join(",")}</span>;
    }
    render(<Sonda />);
    expect(screen.getByTestId("chaves").textContent).toBe(
      "onMouseEnter,onMouseLeave,onFocus,onBlur",
    );
  });

  it("⚠️ monta sem `ResizeObserver` -- é o caso do jsdom", () => {
    // ⚠️ Não é hipótese: ao virar o contorno de sete superfícies, a ausência
    // desta API derrubou 45 testes de uma vez. A guarda é o que permite montar
    // o contorno em qualquer ambiente sem layout.
    expect(() => render(<AnimatedOutline show radius={8} />)).not.toThrow();
  });
});

// SABOTAGENS medidas:
//   A. Tirar `pointer-events-none` da camada. **Cai 1** (o teste da classe) --
//      e note que o teste do clique NÃO cai, porque jsdom não faz layout. Era
//      esta a razão de escrever os dois.
//   B. Voltar a camada para `<div>`. **Cai 1**.
//   C. Tirar `onFocus`/`onBlur` do gancho. **Cai 1**: o contorno deixa de
//      acender por teclado, e nenhuma tela reclama.
//   D. Remover a guarda de `ResizeObserver`. **Cai a suíte inteira**, não só
//      este arquivo -- o que é o próprio registro do incidente.
