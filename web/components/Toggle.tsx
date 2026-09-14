"use client";
// components/Toggle.tsx
// O alternador de DOIS lados — Spec 047, revisão de 09/09.
//
// ⚠️⚠️ É UM `<motion.div layout />`, E NÃO `layoutId`, e a diferença é o
// pedido da Camila: *"quero que adicione essa aqui de toggle mesmo:
// `<motion.div layout />` mas com as palavras"*.
//
//     layoutId  -> DUAS instâncias em lugares diferentes; o motion desmonta
//                  uma, monta a outra e interpola entre as duas. É o que as
//                  abas usam, e é o certo lá: as abas podem ser N, com
//                  larguras diferentes.
//     layout    -> UM elemento só, que continua montado. O pai muda o
//                  `justify-content`, o elemento vai parar noutro lugar, e o
//                  motion anima a diferença. É um interruptor de verdade: a
//                  pastilha nunca deixa de existir, ela ANDA.
//
// A pastilha fica no fluxo (é o único filho em fluxo do contêiner) justamente
// para que o `justify-content` a mova. Uma pastilha `absolute` não se mexeria
// com `justify-content`, e aí `layout` não teria o que animar -- seria preciso
// voltar para `left`/`transform` na mão, que é o que o `layout` existe para
// evitar.
//
// ⚠️ OS DOIS LADOS TÊM A MESMA LARGURA (50%), e isso é escolha, não limitação:
// um interruptor com lados de tamanhos diferentes vira uma barra que muda de
// proporção a cada clique. Com N abas de larguras próprias, o certo é o
// `layoutId` -- e é por isso que este componente é SÓ para dois, e as abas
// continuam em `Tabs.tsx`.
//
// ⚠️ ALTURA FIXA, pelo mesmo motivo: os rótulos ficam numa camada sobreposta
// (para não empurrar a pastilha), então não há conteúdo em fluxo para dar
// altura ao contêiner.
//
// ⚠️ `prefers-reduced-motion` já é honrado pelo bloco global do `globals.css`,
// e o `motion` respeita a mesma media query por conta própria.

import { motion } from "motion/react";

export type ToggleSide<T extends string> = {
  readonly id: T;
  readonly label: string;
  /** Número ao lado. ⚠️ `undefined` esconde; `0` MOSTRA "0". */
  readonly count?: number;
};

export default function Toggle<T extends string>({
  sides,
  active,
  onSelect,
  "aria-label": ariaLabel,
}: {
  /** Exatamente dois — ver o bloco no topo. */
  sides: readonly [ToggleSide<T>, ToggleSide<T>];
  active: T;
  onSelect: (id: T) => void;
  "aria-label": string;
}) {
  const noPrimeiro = active === sides[0].id;

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="relative flex h-9 w-full max-w-[320px] rounded-lg border border-border bg-surface-2 p-1"
      // ⚠️ AQUI MORA A ANIMAÇÃO INTEIRA: é esta única propriedade que muda, e
      // o `layout` da pastilha faz o resto. Sem isto, nada se move.
      style={{ justifyContent: noPrimeiro ? "flex-start" : "flex-end" }}
    >
      <motion.div
        layout
        // Curta de propósito, no mesmo espírito dos 150ms do modal: o
        // suficiente para tirar o corte seco, curto o bastante para não
        // atrasar quem usa o app o dia inteiro.
        transition={{ type: "spring", duration: 0.3, bounce: 0.18 }}
        className="h-full w-1/2 rounded-md bg-surface"
        style={{ boxShadow: "var(--shadow)" }}
      />

      {/* ⚠️ OS RÓTULOS FICAM POR CIMA, e não dentro da pastilha: dentro, a
          troca remontaria o texto e o motion animaria a caixa junto com o
          conteúdo -- o texto "pula". Sobrepostos, a pastilha desliza por trás
          de palavras que nunca se mexem.
          ⚠️ `inset-1` casa com o `p-1` do contêiner, senão os botões cobrem a
          borda e o clique na moldura não faz nada. */}
      <div className="absolute inset-1 flex">
        {sides.map((lado) => {
          const selecionado = lado.id === active;
          return (
            <button
              key={lado.id}
              role="tab"
              aria-selected={selecionado}
              className="tappable flex-1 rounded-md text-sm"
              onClick={() => onSelect(lado.id)}
            >
              <span className={selecionado ? "font-semibold" : "muted"}>
                {lado.label}
              </span>
              {lado.count !== undefined && (
                <span className="muted ml-1.5 text-xs">{lado.count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
