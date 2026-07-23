// Maquina de estados do fechar-com-animacao (lib/useSaidaAnimada.ts).
//
// POR QUE ESTE ARQUIVO EXISTE (Spec 027, D4): em 2026-07-22 esta logica
// morava dentro do TaskDetail e chegou quebrada na tela DEPOIS de passar por
// `tsc --noEmit` limpo e `next build` limpo. Nao era erro de tipo, era de
// estado -- exatamente o que nenhum portao do projeto olhava.
//
// Os dois bugs daquele dia, agora travados aqui:
//   1. `saindo` nao era zerado na reabertura -> como o pai NAO desmonta o
//      componente, toda tarefa aberta depois da primeira nascia invisivel.
//   2. O ref do timer nunca voltava a null -> o segundo fechamento era
//      ignorado para sempre.
//
// Os testes "reabre a MESMA tarefa" e "fecha duas vezes seguidas" sao os que
// falham contra a versao antiga. Se algum dia passarem nas duas, pararam de
// testar alguma coisa.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSaidaAnimada } from "@/lib/useSaidaAnimada";

const ID_A = "tarefa-a";
const ID_B = "tarefa-b";

/** Instala matchMedia (jsdom nao tem) respondendo ao prefers-reduced-motion. */
function fingirMenosMovimento(ativo: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: ativo,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  fingirMenosMovimento(false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Monta o hook simulando o pai, que mantem o componente SEMPRE montado. */
function montar(onFechar = vi.fn()) {
  const r = renderHook(
    ({ idAtual }: { idAtual: string | null }) =>
      useSaidaAnimada({ idAtual, animar: true, onFechar }),
    { initialProps: { idAtual: ID_A as string | null } }
  );
  return { ...r, onFechar };
}

describe("useSaidaAnimada -- fechamento normal", () => {
  it("nasce sem estar saindo", () => {
    const { result } = montar();
    expect(result.current.saindo).toBe(false);
  });

  it("fecharSuave liga `saindo` e SO depois chama onFechar", () => {
    const { result, onFechar } = montar();

    act(() => result.current.fecharSuave());
    // Durante a animacao: marcado como saindo, mas ainda NAO fechou --
    // e isso que segura o unmount ate a animacao terminar.
    expect(result.current.saindo).toBe(true);
    expect(onFechar).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(140));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it("nao fecha antes da hora", () => {
    const { result, onFechar } = montar();
    act(() => result.current.fecharSuave());
    act(() => void vi.advanceTimersByTime(139));
    expect(onFechar).not.toHaveBeenCalled();
  });

  it("clique duplo no fechar dispara onFechar UMA vez", () => {
    const { result, onFechar } = montar();
    act(() => {
      result.current.fecharSuave();
      result.current.fecharSuave();
    });
    act(() => void vi.advanceTimersByTime(140));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });
});

describe("useSaidaAnimada -- reabertura (o bug de 2026-07-22)", () => {
  it("reabrir OUTRA tarefa volta a ficar visivel", () => {
    const { result, rerender } = montar();

    act(() => result.current.fecharSuave());
    act(() => void vi.advanceTimersByTime(140));
    rerender({ idAtual: null }); // pai zerou -> componente segue montado

    rerender({ idAtual: ID_B });
    expect(result.current.saindo).toBe(false);
  });

  it("reabrir a MESMA tarefa volta a ficar visivel", () => {
    // O caso que a versao antiga quebrava: comparar por booleano "abriu"
    // nao distingue reabrir a mesma; por isso a comparacao e por id.
    const { result, rerender } = montar();

    act(() => result.current.fecharSuave());
    act(() => void vi.advanceTimersByTime(140));
    rerender({ idAtual: null });

    rerender({ idAtual: ID_A }); // MESMA tarefa de novo
    expect(result.current.saindo).toBe(false);
  });

  it("fechar DUAS vezes seguidas funciona (guard do timer se libera)", () => {
    const { result, rerender, onFechar } = montar();

    act(() => result.current.fecharSuave());
    act(() => void vi.advanceTimersByTime(140));
    expect(onFechar).toHaveBeenCalledTimes(1);

    rerender({ idAtual: null });
    rerender({ idAtual: ID_A });

    act(() => result.current.fecharSuave());
    expect(result.current.saindo).toBe(true); // o segundo fechamento anima
    act(() => void vi.advanceTimersByTime(140));
    expect(onFechar).toHaveBeenCalledTimes(2);
  });

  it("ciclo longo: abre/fecha cinco vezes sem travar", () => {
    const { result, rerender, onFechar } = montar();
    for (let i = 0; i < 5; i++) {
      act(() => result.current.fecharSuave());
      act(() => void vi.advanceTimersByTime(140));
      rerender({ idAtual: null });
      rerender({ idAtual: i % 2 === 0 ? ID_B : ID_A });
      expect(result.current.saindo).toBe(false);
    }
    expect(onFechar).toHaveBeenCalledTimes(5);
  });
});

describe("useSaidaAnimada -- atalhos que pulam a animacao", () => {
  it("com animar=false fecha na hora (modo pagina)", () => {
    const onFechar = vi.fn();
    const { result } = renderHook(() =>
      useSaidaAnimada({ idAtual: ID_A, animar: false, onFechar })
    );
    act(() => result.current.fecharSuave());
    expect(onFechar).toHaveBeenCalledTimes(1); // sem esperar timer
    expect(result.current.saindo).toBe(false);
  });

  it("com prefers-reduced-motion fecha na hora", () => {
    // Com a animacao desligada pelo CSS, esperar a duracao seria so
    // lentidao sem contrapartida visual.
    fingirMenosMovimento(true);
    const onFechar = vi.fn();
    const { result } = renderHook(() =>
      useSaidaAnimada({ idAtual: ID_A, animar: true, onFechar })
    );
    act(() => result.current.fecharSuave());
    expect(onFechar).toHaveBeenCalledTimes(1);
  });
});

describe("useSaidaAnimada -- limpeza", () => {
  it("desmontar durante a saida nao dispara onFechar depois", () => {
    // Sem o cleanup, o timer sobreviveria ao unmount e chamaria de volta
    // um pai que ja nao existe.
    const onFechar = vi.fn();
    const { result, unmount } = renderHook(() =>
      useSaidaAnimada({ idAtual: ID_A, animar: true, onFechar })
    );
    act(() => result.current.fecharSuave());
    unmount();
    act(() => void vi.advanceTimersByTime(500));
    expect(onFechar).not.toHaveBeenCalled();
  });
});
