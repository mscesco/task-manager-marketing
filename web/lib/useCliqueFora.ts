// =====================================================
// useFecharAoClicarFora -- clicar fora do modal fecha; arrastar pra fora não.
// O `click` do DOM dispara no ancestral comum do mousedown e do mouseup:
// selecionar texto dentro e soltar fora cai no scrim, e `stopPropagation` no
// card não pega. Por isso a regra pareia mousedown e mouseup.
// =====================================================
import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";

/**
 * Decide se o clique fecha.
 *
 *   pressionouFora | soltouFora | fecha?
 *   ---------------|------------|-------
 *   sim            | sim        | SIM   -- clique fora de verdade
 *   nao            | sim        | nao   -- selecionou texto dentro e soltou fora
 *   sim            | nao        | nao   -- comecou fora e soltou dentro
 *   nao            | nao        | nao   -- clique dentro
 */
export function deveFecharNoClique(
  pressionouFora: boolean,
  soltouFora: boolean
): boolean {
  return pressionouFora && soltouFora;
}

/**
 * Handlers para espalhar no scrim (o fundo escuro), não no card: a regra
 * depende de `target === currentTarget`.
 */
export function useFecharAoClicarFora(onFechar: () => void) {
  const pressionouFora = useRef(false);
  const soltouFora = useRef(false);

  const onMouseDown = useCallback((e: ReactMouseEvent) => {
    pressionouFora.current = e.target === e.currentTarget;
  }, []);

  const onMouseUp = useCallback((e: ReactMouseEvent) => {
    soltouFora.current = e.target === e.currentTarget;
  }, []);

  const onClick = useCallback(() => {
    const fecha = deveFecharNoClique(pressionouFora.current, soltouFora.current);
    // Zera sempre, senão o próximo clique herda o estado do anterior.
    pressionouFora.current = false;
    soltouFora.current = false;
    if (fecha) onFechar();
  }, [onFechar]);

  return { onMouseDown, onMouseUp, onClick };
}

// =====================================================
// useFecharAoClicarForaDe -- painel suspenso (popover) fecha ao apertar fora.
// Sem scrim: usa `contains` e basta o mousedown fora do elemento.
// =====================================================

/**
 * Fecha quando o ponteiro e PRESSIONADO fora de `ref`, enquanto `aberto`.
 *
 * `fechar` pode mudar a cada render (uma arrow nova): o hook guarda a mais
 * recente, e o ouvinte so e refeito quando `aberto` muda.
 */
export function useFecharAoClicarForaDe(
  ref: RefObject<HTMLElement | null>,
  aberto: boolean,
  fechar: () => void,
): void {
  const fecharRef = useRef(fechar);
  fecharRef.current = fechar;
  useEffect(() => {
    if (!aberto) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) fecharRef.current();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [aberto, ref]);
}
