"use client";
// components/Tabs.tsx
// Tabs com indicador que DESLIZA entre elas — Spec 047, revisão de 09/09.
//
// ⚠️⚠️ O `layoutId` DO MOTION É O TRUQUE INTEIRO, e é por ele que a
// dependência entrou. Com CSS puro dá para animar um sublinhado, mas ele
// precisa de largura fixa: o indicador não sabe medir a aba de destino. Com
// `layoutId`, duas instâncias do mesmo id em lugares diferentes viram UM
// elemento que o motion interpola — ele mede a origem e o destino sozinho, e
// as abas podem ter larguras diferentes ("Ativos" e "Convidados" têm).
//
// ⚠️⚠️ ESTAS SÃO AS ABAS: recortes de uma mesma lista, onde a lista continua
// sendo o assunto e a aba é só o filtro. O ALTERNADOR -- escolher entre dois
// assuntos -- mora em `Toggle.tsx`, com mecânica diferente
// (`<motion.div layout />`, um elemento que anda, em vez de duas instâncias
// interpoladas).
//
// ⚠️ E a separação não é organização de código: as duas formas dizem coisas
// diferentes. Se a fileira que troca o ASSUNTO tivesse a mesma cara da que só
// RECORTA, a tela teria duas linhas de palavras e nenhuma pista de que fazem
// coisas distintas -- foi exatamente o que a Camila apontou em 09/09.
//
// ⚠️ AQUI HOUVE UMA VARIANTE `pilula`, tentando servir os dois casos com o
// mesmo `layoutId`. Ela saiu: o alternador que a Camila queria é um
// interruptor de verdade, e interruptor não se faz com duas instâncias
// trocadas -- se faz com uma que se move.
//
// ⚠️ `prefers-reduced-motion` JÁ É HONRADO por um bloco global do
// `globals.css` (`* { animation: none !important }`), e o `motion` respeita a
// mesma media query por conta própria. Quem pede menos movimento vê a troca
// seca, sem nada a mais aqui.
//
// ⚠️ MORA EM `components/`, então tem guardião — `app/` fica fora do
// `include` do vitest (§7 da spec).

import { motion } from "motion/react";

export type Tab<T extends string> = {
  readonly id: T;
  readonly label: string;
  /** Número ao lado. ⚠️ `undefined` esconde; `0` MOSTRA "0". */
  readonly count?: number;
};

// Curtas de propósito, no mesmo espírito dos 150ms do modal: o suficiente
// para tirar o corte seco, curto o bastante para não atrasar quem usa o app o
// dia inteiro.
const SPRING = { type: "spring", duration: 0.3, bounce: 0.18 } as const;

export default function Tabs<T extends string>({
  tabs,
  active,
  onSelect,
  /** Distingue os indicadores quando há dois grupos de abas na mesma tela. */
  group = "abas",
  "aria-label": ariaLabel,
}: {
  tabs: readonly Tab<T>[];
  active: T;
  onSelect: (id: T) => void;
  group?: string;
  "aria-label": string;
}) {
  return (
    // ⚠️ `role="tablist"` + `aria-selected` nos botões: sem isso o leitor de
    // tela anuncia "botão", e a pessoa não sabe que está num grupo nem em
    // qual item está.
    <div
      role="tablist"
      aria-label={ariaLabel}
      // As abas se apoiam numa régua; o indicador nasce sobre ela.
      className="flex gap-1 border-b border-border"
    >
      {tabs.map((aba) => {
        const selecionada = aba.id === active;
        return (
          <button
            key={aba.id}
            role="tab"
            aria-selected={selecionada}
            // ⚠️⚠️ O CONTORNO DE FOCO SAIU DAQUI, a pedido dela: *"nessa área
            // pode tirar o contorno: em volta de ativos, inativos e
            // convidados"*. O anel retangular do `:focus-visible` global
            // envolvia uma aba de cantos arredondados só em cima, e ficava
            // torto.
            //
            // ⚠️ MAS O FOCO CONTINUA VISÍVEL -- ele virou FUNDO
            // (`focus-visible:bg-surface-2`), e não sumiu. Um controle que o
            // teclado alcança sem dizer onde está é inutilizável para quem não
            // usa mouse, e a barra já perdeu essa briga uma vez (a §C1/C2 do
            // `globals.css` existe por isso).
            className="tappable relative rounded-t px-3 pb-2 pt-1.5 text-sm outline-none focus-visible:bg-surface-2 focus-visible:outline-none"
            onClick={() => onSelect(aba.id)}
          >
            {/* ⚠️ O INDICADOR É IRMÃO DO TEXTO, e não pai: envolvendo o
                rótulo, cada troca o remontaria e o motion animaria a caixa
                junto com o conteúdo, o que faz o texto "pular".
                ⚠️ `-bottom-px` põe a barra EM CIMA da régua do `border-b`, e
                não abaixo dela: um pixel de folga faria o sublinhado parecer
                solto, e a régua continuaria visível por baixo. */}
            {selecionada && (
              <motion.span
                layoutId={`${group}-indicador`}
                className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-accent"
                transition={SPRING}
              />
            )}
            <span
              className={selecionada ? "font-semibold text-accent" : "muted"}
            >
              {aba.label}
            </span>
            {aba.count !== undefined && (
              <span className="muted ml-1.5 text-xs">{aba.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
