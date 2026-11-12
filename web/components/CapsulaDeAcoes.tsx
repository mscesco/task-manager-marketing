"use client";

import type { ReactNode } from "react";

/**
 * A cápsula das ações de um comentário: reagir, editar, apagar.
 *
 * Aparece com o mouse sobre a linha (o `group` é da `LinhaComentario`), com o
 * foco dentro ou com o seletor de reação aberto (`has-[[aria-expanded=true]]`).
 * Usa opacidade, não `display`, para o Tab alcançar os botões.
 */
export default function CapsulaDeAcoes({ children }: { children: ReactNode }) {
  return (
    <span
      className="ml-auto flex items-center gap-0.5 rounded-full border border-border bg-surface px-1 py-0.5 opacity-0 transition-opacity duration-150 [@media(hover:none)]:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100"
    >
      {children}
    </span>
  );
}

/**
 * A forma de cada botão da cápsula, usada aqui, no `SeletorDeReacao` e na
 * `LinhaComentario`. 26px de alvo (mínimo 24).
 */
export const BOTAO_DA_CAPSULA =
  "flex h-[26px] w-[26px] items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50";
