// Máquina de estados do fechar-com-animação (lib/useSaidaAnimada.ts). O pai
// NÃO desmonta o componente: por isso `saindo` tem de zerar na reabertura, e o
// timer tem de se liberar para o segundo fechamento.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DURACAO_SAIDA_MS, useSaidaAnimada } from "@/lib/useSaidaAnimada";

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

    act(() => void vi.advanceTimersByTime(DURACAO_SAIDA_MS));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it("nao fecha antes da hora", () => {
    const { result, onFechar } = montar();
    act(() => result.current.fecharSuave());
    act(() => void vi.advanceTimersByTime(DURACAO_SAIDA_MS - 1));
    expect(onFechar).not.toHaveBeenCalled();
  });

  it("clique duplo no fechar dispara onFechar UMA vez", () => {
    const { result, onFechar } = montar();
    act(() => {
      result.current.fecharSuave();
      result.current.fecharSuave();
    });
    act(() => void vi.advanceTimersByTime(DURACAO_SAIDA_MS));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });
});

describe("useSaidaAnimada -- reabertura", () => {
  it("reabrir OUTRA tarefa volta a ficar visivel", () => {
    const { result, rerender } = montar();

    act(() => result.current.fecharSuave());
    act(() => void vi.advanceTimersByTime(DURACAO_SAIDA_MS));
    rerender({ idAtual: null }); // pai zerou -> componente segue montado

    rerender({ idAtual: ID_B });
    expect(result.current.saindo).toBe(false);
  });

  it("reabrir a MESMA tarefa volta a ficar visivel", () => {
    // O caso que a versao antiga quebrava: comparar por booleano "abriu"
    // nao distingue reabrir a mesma; por isso a comparacao e por id.
    const { result, rerender } = montar();

    act(() => result.current.fecharSuave());
    act(() => void vi.advanceTimersByTime(DURACAO_SAIDA_MS));
    rerender({ idAtual: null });

    rerender({ idAtual: ID_A }); // MESMA tarefa de novo
    expect(result.current.saindo).toBe(false);
  });

  it("fechar DUAS vezes seguidas funciona (guard do timer se libera)", () => {
    const { result, rerender, onFechar } = montar();

    act(() => result.current.fecharSuave());
    act(() => void vi.advanceTimersByTime(DURACAO_SAIDA_MS));
    expect(onFechar).toHaveBeenCalledTimes(1);

    rerender({ idAtual: null });
    rerender({ idAtual: ID_A });

    act(() => result.current.fecharSuave());
    expect(result.current.saindo).toBe(true); // o segundo fechamento anima
    act(() => void vi.advanceTimersByTime(DURACAO_SAIDA_MS));
    expect(onFechar).toHaveBeenCalledTimes(2);
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
