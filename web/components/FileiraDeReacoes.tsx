"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { DUR } from "@/lib/motion";

import { rotuloDeQuemReagiu, type Reacao } from "@/lib/reacoes";

/**
 * Mola criticamente amortecida, a mesma da gaveta de subtime.
 */
const MOLA = { type: "spring", duration: DUR[3], bounce: 0 } as const;

/**
 * A fileira de reações de um comentário: uma pílula por emoji, na ordem do
 * servidor; a da própria pessoa fica marcada. O estado vem de fora
 * (`LinhaComentario`).
 *
 * `initial={false}`: as pílulas existentes não animam ao abrir. O contêiner
 * existe mesmo vazio para a última pílula animar a saída (`empty:hidden` tira
 * o espaço). `useReducedMotion` porque o `globals.css` só alcança CSS.
 */
export default function FileiraDeReacoes({
  reactions,
  membros,
  meuId,
  onAlternar,
  desabilitado,
}: {
  reactions: readonly Reacao[];
  /** O mapa de membros da tela -- para virar nome no titulo da pilula. */
  membros: ReadonlyMap<string, { name: string }>;
  meuId: string | null;
  /** Clique na pilula: poe aquele emoji, ou tira se ja for o meu. */
  onAlternar: (emoji: string) => void;
  desabilitado?: boolean;
}) {
  const menosMovimento = useReducedMotion();
  const transicao = menosMovimento ? { duration: 0 } : MOLA;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 empty:hidden">
      <AnimatePresence initial={false}>
        {reactions.map((r) => {
          const souEu = meuId != null && r.user_ids.includes(meuId);
          const quem = rotuloDeQuemReagiu(r.user_ids, membros, meuId);
          return (
            <motion.button
              key={r.emoji}
              layout
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={transicao}
              type="button"
              className={
                souEu
                  ? "flex items-center gap-1 rounded-full border border-accent bg-accent-soft px-2 py-0.5 text-xs"
                  : "flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs"
              }
              disabled={desabilitado}
              onClick={() => onAlternar(r.emoji)}
              title={quem}
              /* Sinal redundante: a borda diz "é minha" para quem vê; o rótulo, para quem ouve. */
              aria-label={
                souEu
                  ? `${r.emoji}, ${r.user_ids.length}: ${quem} — você reagiu, clique para tirar`
                  : `${r.emoji}, ${r.user_ids.length}: ${quem} — clique para reagir`
              }
            >
              <span aria-hidden>{r.emoji}</span>
              {/* O numero troca com um deslize curto: a chave e a contagem,
                  entao o `AnimatePresence` ve "saiu 1, entrou 2". */}
              <span className="relative inline-flex overflow-hidden">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={r.user_ids.length}
                    initial={{ y: -8, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 8, opacity: 0 }}
                    transition={transicao}
                  >
                    {r.user_ids.length}
                  </motion.span>
                </AnimatePresence>
              </span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
