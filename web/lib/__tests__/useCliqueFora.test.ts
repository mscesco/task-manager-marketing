// Clicar fora fecha; arrastar pra fora nao (lib/useCliqueFora.ts).
//
// O teste que importa e "seleciona texto dentro e solta fora": e o caso
// reportado, e e o unico que passa na versao antiga com `stopPropagation`.
import { fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { deveFecharNoClique, useFecharAoClicarFora, useFecharAoClicarForaDe } from "@/lib/useCliqueFora";

describe("deveFecharNoClique", () => {
  it("pressionou fora e soltou fora -> FECHA", () => {
    expect(deveFecharNoClique(true, true)).toBe(true);
  });
  it("pressionou DENTRO e soltou fora -> nao fecha (arrastou selecionando)", () => {
    expect(deveFecharNoClique(false, true)).toBe(false);
  });
  it("pressionou fora e soltou DENTRO -> nao fecha", () => {
    expect(deveFecharNoClique(true, false)).toBe(false);
  });
  it("pressionou dentro e soltou dentro -> nao fecha", () => {
    expect(deveFecharNoClique(false, false)).toBe(false);
  });
});

// O scrim e o `currentTarget`; qualquer no de dentro do card e um `target`
// diferente. Nao precisa de DOM real -- o hook so compara as duas coisas.
const scrim = { id: "scrim" };
const dentroDoCard = { id: "descricao" };
const ev = (target: unknown) =>
  ({ target, currentTarget: scrim }) as unknown as React.MouseEvent;

describe("useFecharAoClicarFora", () => {
  it("clique inteiro no fundo fecha", () => {
    const fechar = vi.fn();
    const { result } = renderHook(() => useFecharAoClicarFora(fechar));
    result.current.onMouseDown(ev(scrim));
    result.current.onMouseUp(ev(scrim));
    result.current.onClick();
    expect(fechar).toHaveBeenCalledTimes(1);
  });

  it("seleciona texto DENTRO e solta FORA nao fecha", () => {
    // O caso da captura: arrastar da descricao ate o quadro atras.
    const fechar = vi.fn();
    const { result } = renderHook(() => useFecharAoClicarFora(fechar));
    result.current.onMouseDown(ev(dentroDoCard));
    result.current.onMouseUp(ev(scrim));
    result.current.onClick();
    expect(fechar).not.toHaveBeenCalled();
  });

  it("comeca no fundo e solta dentro do card nao fecha", () => {
    const fechar = vi.fn();
    const { result } = renderHook(() => useFecharAoClicarFora(fechar));
    result.current.onMouseDown(ev(scrim));
    result.current.onMouseUp(ev(dentroDoCard));
    result.current.onClick();
    expect(fechar).not.toHaveBeenCalled();
  });

  it("gesto recusado NAO deixa resto pro clique seguinte", () => {
    // Regressao do `zera SEMPRE` no onClick. A ordem importa: o resto
    // perigoso e o `pressionouFora` ficar TRUE de um gesto que nao fechou.
    // Se ele nao for zerado, basta um mouseup no fundo depois -- sem
    // mousedown nenhum -- pra fechar por heranca.
    const fechar = vi.fn();
    const { result } = renderHook(() => useFecharAoClicarFora(fechar));

    // Gesto 1: apertou no fundo, soltou dentro do card. Nao fecha, e deixa
    // `pressionouFora` marcado se o hook nao zerar.
    result.current.onMouseDown(ev(scrim));
    result.current.onMouseUp(ev(dentroDoCard));
    result.current.onClick();
    expect(fechar).not.toHaveBeenCalled();

    // Gesto 2: so o soltar no fundo, sem apertar de novo.
    result.current.onMouseUp(ev(scrim));
    result.current.onClick();
    expect(fechar).not.toHaveBeenCalled();
  });

  it("dois cliques legitimos seguidos fecham as duas vezes", () => {
    const fechar = vi.fn();
    const { result } = renderHook(() => useFecharAoClicarFora(fechar));
    for (let i = 0; i < 2; i++) {
      result.current.onMouseDown(ev(scrim));
      result.current.onMouseUp(ev(scrim));
      result.current.onClick();
    }
    expect(fechar).toHaveBeenCalledTimes(2);
  });
});

describe("useFecharAoClicarForaDe -- o painel suspenso (07/10: eram 15 cópias)", () => {
  function montar(aberto: boolean, fechar: () => void) {
    const dentro = document.createElement("div");
    const fora = document.createElement("div");
    document.body.append(dentro, fora);
    const ref = { current: dentro };
    const r = renderHook(({ a, f }) => useFecharAoClicarForaDe(ref, a, f), {
      initialProps: { a: aberto, f: fechar },
    });
    return { dentro, fora, ...r };
  }
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("apertar FORA fecha; apertar DENTRO não", () => {
    const fechar = vi.fn();
    const { dentro, fora } = montar(true, fechar);
    fireEvent.mouseDown(dentro);
    expect(fechar).not.toHaveBeenCalled();
    fireEvent.mouseDown(fora);
    expect(fechar).toHaveBeenCalledTimes(1);
  });

  it("fechado, não escuta nada", () => {
    const fechar = vi.fn();
    const { fora } = montar(false, fechar);
    fireEvent.mouseDown(fora);
    expect(fechar).not.toHaveBeenCalled();
  });

  it("usa o `fechar` mais recente, sem refazer o ouvinte", () => {
    const antigo = vi.fn();
    const novo = vi.fn();
    const { fora, rerender } = montar(true, antigo);
    rerender({ a: true, f: novo });
    fireEvent.mouseDown(fora);
    expect(antigo).not.toHaveBeenCalled();
    expect(novo).toHaveBeenCalledTimes(1);
  });
});
