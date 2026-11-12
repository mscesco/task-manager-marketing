"use client";

import { useSyncExternalStore } from "react";

/**
 * O detalhe da tarefa está com as duas colunas lado a lado (900px ou mais)?
 * Tem de bater com o `min-[900px]:grid` do `TaskDetail`.
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
