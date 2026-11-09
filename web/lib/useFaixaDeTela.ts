"use client";

import { useSyncExternalStore } from "react";

import { faixaDaLargura, type FaixaDeTela } from "@/lib/sidebar";

function assinar(avisar: () => void): () => void {
  window.addEventListener("resize", avisar);
  return () => window.removeEventListener("resize", avisar);
}

/** A faixa de largura da tela, acompanhando rotacao e redimensionamento. */
export function useFaixaDeTela(): FaixaDeTela {
  return useSyncExternalStore(
    assinar,
    () => faixaDaLargura(window.innerWidth),
    () => "computador",
  );
}
