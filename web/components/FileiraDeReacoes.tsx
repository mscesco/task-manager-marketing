"use client";

import { rotuloDeQuemReagiu, type Reacao } from "@/lib/reacoes";

/**
 * A fileira de reacoes de um comentario (Spec 050, §4.7).
 *
 * Uma pilula por emoji, na ordem que o servidor mandou (a da reacao mais
 * antiga com aquele emoji). A pilula da propria pessoa fica marcada.
 *
 * ⚠️ O ESTADO VEM DE FORA. Este componente nao chama a API nem guarda
 * reacao: quem faz isso e a `LinhaComentario`, que ja tem o comentario e
 * troca a linha inteira quando o servidor responde.
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
  if (reactions.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {reactions.map((r) => {
        const souEu = meuId != null && r.user_ids.includes(meuId);
        const quem = rotuloDeQuemReagiu(r.user_ids, membros, meuId);
        return (
          <button
            key={r.emoji}
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
            <span>{r.user_ids.length}</span>
          </button>
        );
      })}
    </div>
  );
}
