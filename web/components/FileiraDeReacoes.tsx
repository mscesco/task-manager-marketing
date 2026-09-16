"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { rotuloDeQuemReagiu, type Reacao } from "@/lib/reacoes";

/**
 * Mesma mola da lista animada da gaveta de subtime (`SubteamDrawer`):
 * criticamente amortecida -- chega e para, sem o tranco de um overshoot.
 */
const MOLA = { type: "spring", duration: 0.32, bounce: 0 } as const;

/**
 * A fileira de reacoes de um comentario (Spec 050, §4.7).
 *
 * Uma pilula por emoji, na ordem que o servidor mandou (a da reacao mais
 * antiga com aquele emoji). A pilula da propria pessoa fica marcada.
 *
 * ⚠️ O ESTADO VEM DE FORA. Este componente nao chama a API nem guarda
 * reacao: quem faz isso e a `LinhaComentario`, que ja tem o comentario e
 * troca a linha inteira quando o servidor responde.
 *
 * ⭐ ANIMADA -- pedido dela em 16/09: *"quero uma animação para a aparição da
 * reação na parte inferior do comentário"*. A pilula nova cresce no lugar, a
 * que sai encolhe, e as vizinhas DESLIZAM (`layout`) em vez de pular.
 *
 * ⚠️ `initial={false}`: as pilulas que ja existiam quando o comentario abre
 * NAO animam. Animar tudo ao abrir o detalhe seria movimento sem noticia.
 *
 * ⚠️ O CONTEINER EXISTE MESMO VAZIO, e isso e de proposito: com o antigo
 * `return null` sem reacao, a ULTIMA pilula a sair era desmontada junto com
 * a fileira e nunca animava a saida. `empty:hidden` tira o espaco quando nao
 * sobra nada.
 *
 * ⚠️ `useReducedMotion`: o app nao tem `MotionConfig`, e o bloco de
 * `prefers-reduced-motion` do `globals.css` so alcanca animacao de CSS -- nao
 * as do `motion`. Aqui a preferencia do sistema e respeitada na mao.
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
              /* ⚠️ SINAL REDUNDANTE (web/AGENTS.md §8): a borda diz "e minha"
                 para quem ve; o rotulo diz para quem ouve. Cor sozinha nao. */
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
