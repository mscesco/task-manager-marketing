"use client";

import type { ReactNode } from "react";

/**
 * A capsula das acoes de um comentario -- reagir, editar, apagar (Spec 050).
 *
 * ⚠️ Pedido dela em 16/09, com captura: *"gostaria que os botões ali ficassem
 * dentro de alguma cápsula, arredondados por algo, acho que está muito
 * avulso. Pelo menos um contorno"*. Eram tres botoes soltos na linha do nome.
 *
 * ⚠️⚠️ A CAPSULA APARECE COM O MOUSE EM CIMA DA LINHA -- ou com o foco de
 * teclado dentro dela, ou com o seletor de reacao aberto. Quem desenha o
 * `group` e a `LinhaComentario`. Os botoes continuam no DOM (opacidade, e nao
 * `display`), entao o `Tab` os alcanca e o `focus-within` os revela.
 *
 * ⚠️ `has-[[aria-expanded=true]]` mantem a capsula visivel com o seletor
 * aberto: sem isso, levar o mouse do botao ate um painel que abriu para baixo
 * e rolou para fora da linha a apagaria no meio do gesto.
 */
export default function CapsulaDeAcoes({ children }: { children: ReactNode }) {
  return (
    <span
      className="ml-auto flex items-center gap-0.5 rounded-full border border-border bg-surface px-1 py-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100"
    >
      {children}
    </span>
  );
}

/**
 * A forma de cada botao dentro da capsula.
 *
 * ⚠️ UMA constante, e nao a mesma string em tres lugares: o botao de reagir
 * mora no `SeletorDeReacao`, e os de editar e apagar na `LinhaComentario`.
 * 26px de alvo -- o `web/AGENTS.md` §3 pede no minimo 24.
 */
export const BOTAO_DA_CAPSULA =
  "flex h-[26px] w-[26px] items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50";
