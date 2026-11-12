// Fechar com animação de saída. Quem consome mantém o componente sempre
// montado (`task={null}` quando fechado), então o estado sobrevive ao
// fechamento e é zerado na reabertura, inclusive da mesma tarefa.
import { useCallback, useEffect, useRef, useState } from "react";

/** Duracao padrao, casada com a animacao `.modal-card` do globals.css. */
export const DURACAO_SAIDA_MS = 140;

/** O usuario pediu menos movimento no sistema operacional? */
function preferindoMenosMovimento(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type SaidaAnimada = {
  /** true enquanto a animacao de saida roda (vira `data-saindo` no DOM). */
  saindo: boolean;
  /** Dispara o fechamento -- anima e so entao chama `onFechar`. */
  fecharSuave: () => void;
};

export function useSaidaAnimada({
  idAtual,
  animar,
  onFechar,
  duracaoMs = DURACAO_SAIDA_MS,
}: {
  /** Id do que esta aberto; `null` quando fechado. */
  idAtual: string | null;
  /** false -> fecha na hora (ex.: modo pagina, sem scrim). */
  animar: boolean;
  onFechar: () => void;
  duracaoMs?: number;
}): SaidaAnimada {
  const [saindo, setSaindo] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  // Zera `saindo` na reabertura, durante o render (antes da pintura, sem um
  // frame invisível). Comparar por id cobre reabrir a mesma tarefa.
  const [idVisivel, setIdVisivel] = useState<string | null>(null);
  if (idAtual !== idVisivel) {
    setIdVisivel(idAtual);
    if (idAtual !== null && saindo) setSaindo(false);
  }

  const fecharSuave = useCallback(() => {
    // Sem animação (modo página) ou com menos movimento pedido: fecha direto.
    if (!animar || preferindoMenosMovimento()) {
      onFechar();
      return;
    }
    if (timer.current !== null) return; // ja esta saindo
    setSaindo(true);
    timer.current = window.setTimeout(() => {
      // Libera o ref antes de fechar: é o guard de "já está saindo".
      timer.current = null;
      onFechar();
    }, duracaoMs);
  }, [animar, onFechar, duracaoMs]);

  return { saindo, fecharSuave };
}

export default useSaidaAnimada;
