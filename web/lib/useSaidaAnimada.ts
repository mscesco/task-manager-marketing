// =====================================================
// useSaidaAnimada -- fechar com animacao de saida (Spec 027, D4)
// -----------------------------------------------------
// Extraido de dentro do TaskDetail (1545 linhas), onde a mesma logica so
// seria alcancavel por um teste caro. Aqui e uma unidade fechada, coberta
// pelo proprio arquivo de teste ao lado.
//
// FRONTEIRA (Spec 027): `lib/` decide, `components/` desenha. Este arquivo
// e a aplicacao pratica dessa regra -- o bug de 2026-07-22 nasceu de uma
// maquina de estados escondida na camada de apresentacao.
//
// O PROBLEMA QUE ELE RESOLVE: quem consome (Board, minhas-tarefas) mantem o
// componente SEMPRE MONTADO, passando `task={null}` quando fechado. Logo o
// estado interno SOBREVIVE ao fechamento e precisa ser zerado na reabertura
// -- inclusive quando a tarefa reaberta e a MESMA de antes.
// =====================================================
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

  // Zera `saindo` na reabertura. Ajuste durante o RENDER (padrao do React
  // para estado derivado de prop): roda antes da pintura, entao nao existe
  // um frame com o conteudo ja invisivel. Comparar por id -- e nao por um
  // booleano "abriu" -- e o que cobre reabrir a MESMA tarefa.
  const [idVisivel, setIdVisivel] = useState<string | null>(null);
  if (idAtual !== idVisivel) {
    setIdVisivel(idAtual);
    if (idAtual !== null && saindo) setSaindo(false);
  }

  const fecharSuave = useCallback(() => {
    // Sem animacao (modo pagina) ou com menos movimento pedido: fecha direto.
    // Esperar a duracao com a animacao desligada pelo CSS seria so lentidao
    // sem contrapartida visual.
    if (!animar || preferindoMenosMovimento()) {
      onFechar();
      return;
    }
    if (timer.current !== null) return; // ja esta saindo
    setSaindo(true);
    timer.current = window.setTimeout(() => {
      // Libera o ref ANTES de fechar: ele e o guard de "ja esta saindo", e
      // sem zerar aqui o segundo fechamento seria ignorado para sempre.
      timer.current = null;
      onFechar();
    }, duracaoMs);
  }, [animar, onFechar, duracaoMs]);

  return { saindo, fecharSuave };
}

export default useSaidaAnimada;
