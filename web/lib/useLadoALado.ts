"use client";

import { useSyncExternalStore } from "react";

/**
 * O detalhe da tarefa está com as duas colunas lado a lado (900px ou mais)?
 *
 * ⚠️ 900, e não as faixas de `useFaixaDeTela` (768/1024): é o corte em que
 * o `TaskDetail` empilha as colunas (`min-[900px]:grid`). Os dois têm de
 * concordar, senão as ações vão para a lateral numa largura em que a lateral
 * está lá embaixo.
 *
 * Sem `matchMedia` (jsdom) responde "lado a lado", o desenho do computador.
 */
const CONSULTA = "(min-width: 900px)";

function lista(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(CONSULTA) : null;
}

function assinar(avisar: () => void): () => void {
  const mq = lista();
  mq?.addEventListener("change", avisar);
  return () => mq?.removeEventListener("change", avisar);
}

export function useLadoALado(): boolean {
  return useSyncExternalStore(
    assinar,
    () => lista()?.matches ?? true,
    () => true,
  );
}
