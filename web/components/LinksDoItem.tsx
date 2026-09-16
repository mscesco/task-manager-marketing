"use client";
// components/LinksDoItem.tsx
// Os links com nome de um projeto ou de uma tarefa, como botões (Spec 052, B).
//
// ⚠️ O NOME É O QUE APARECE, e o endereço fica no `title` -- é o pedido dela:
// *"quando confirmar aparecer somente o nome como hiperlink"*. O endereço do
// Drive tem 80 caracteres e não diz nada a quem lê.
//
// ⚠️ `<a>` DE VERDADE, em aba nova e com `rel="noopener noreferrer"`: abre com
// clique do meio e Ctrl+clique (web/AGENTS.md §5), e a aba nova não ganha
// acesso a esta. O servidor só grava `http`/`https`, então `href` nunca é
// `javascript:`.

import { Link2 } from "lucide-react";
import type { LinkItem } from "@/lib/api";

export default function LinksDoItem({
  links,
  rotulo,
}: {
  links: readonly LinkItem[];
  /** Nome acessível da lista ("Links do projeto", "Links da tarefa"). */
  rotulo: string;
}) {
  if (links.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label={rotulo}>
      {links.map((l) => (
        <li key={l.id} className="min-w-0">
          <a
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            title={l.url}
            className="inline-flex max-w-[260px] items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent-soft"
          >
            <Link2 size={13} aria-hidden className="shrink-0" />
            <span className="truncate">{l.title}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
