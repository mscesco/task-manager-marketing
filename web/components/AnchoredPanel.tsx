"use client";
// components/AnchoredPanel.tsx
// O painel suspenso, ancorado a um gatilho — Spec 047, revisão de 09/09.
//
// ⚠️⚠️ ELE EXISTE PORQUE JÁ HAVIA TRÊS CÓPIAS desta mecânica (o seletor de
// contexto, o de papel e o de time), e uma delas estava errada: o seletor de
// papel da organização usava `position: absolute` dentro da gaveta, e a
// gaveta tem `overflow-y-auto` — o painel nascia RECORTADO e deslocado para
// fora. A Camila viu: *"o seletor de papéis da organização ficou bugado"*.
//
// Três cópias de uma regra são três chances de uma divergir. Esta é a regra:
//
//   1. `fixed`, e não `absolute` — as gavetas e a barra lateral rolam por
//      dentro, e `absolute` é recortado por elas.
//   2. MEDE O GATILHO NA ABERTURA, e por isso FECHA ao rolar ou
//      redimensionar: a medida envelhece no primeiro pixel de rolagem, e um
//      painel flutuando longe do gatilho é pior que um painel fechado.
//   3. ABRE PARA CIMA quando não há espaço embaixo — menus no pé de uma
//      gaveta nasceriam fora da tela.
//   4. Fecha ao clicar fora com `contains`, e NÃO comparando `e.target ===
//      e.currentTarget`: aquele é o padrão do SCRIM de modal, e aqui fecharia
//      ao clicar DENTRO da lista.
//   5. A escala nasce do lado do gatilho: do centro, o painel cresceria para
//      os dois lados e pareceria brotar do nada.
//   6. O painel NAO SAI PELA DIREITA -- ele desloca para caber na janela. O
//      gatilho pode ser uma pilula estreita, e o painel e mais largo que ela.
//
// ⚠️ `bounce: 0`, e nao um valor pequeno: com qualquer overshoot a caixa
// passa do tamanho final e volta, e isso le-se como TRANCO -- *"a animacao das
// aparicoes de caixas está levemente brusca (...) gostaria de algo mais
// fluido, sem bounce"*. Mola sem bounce e criticamente amortecida: chega e
// para. O indicador das ABAS mantem o dele, porque ali o movimento e de um
// objeto que desliza, e nao de uma caixa que nasce.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type MutableRefObject,
} from "react";
import { motion } from "motion/react";

/** Quanto o painel precisa de espaço embaixo para não virar para cima. */
const ESPACO_MINIMO = 220;
/** Respiro nas bordas da janela, para o painel não encostar. */
const MARGEM = 8;

export type PanelBox = {
  readonly top?: number;
  readonly bottom?: number;
  readonly left: number;
  readonly width: number;
  /** Teto de largura, para o painel caber na janela. */
  readonly maxWidth: number;
  readonly paraCima: boolean;
};

/**
 * Largura assumida quando o gatilho é estreito (uma pílula, por exemplo).
 *
 * ⚠️ Ela existe para o CÁLCULO DE BORDA: sem ela, o painel de um gatilho de
 * 80px seria posicionado como se coubesse em 80px, e os 200px reais vazariam
 * pela direita.
 */
const LARGURA_MINIMA = 220;

export function useAnchoredPanel<T extends HTMLElement>(
  isOpen: boolean,
  onClose: () => void,
): {
  anchorRef: MutableRefObject<T | null>;
  panelRef: MutableRefObject<HTMLDivElement | null>;
  box: PanelBox | null;
} {
  const anchorRef = useRef<T | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<PanelBox | null>(null);

  // ⚠️ `useLayoutEffect` e não `useEffect`: medir depois da PINTURA faria o
  // painel aparecer um quadro no canto (0,0) e saltar para o lugar.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    const cabeEmbaixo = window.innerHeight - r.bottom > ESPACO_MINIMO;

    // ⚠️⚠️ O PAINEL NAO PODE SAIR PELA DIREITA, e saía: relatado duas vezes
    // pela Camila -- *"o seletor de papel, se o nome é muito grande, fica
    // cortado"*. O gatilho é uma pílula estreita, e o painel é mais largo que
    // ela; ancorado à esquerda do gatilho, ele passava da janela.
    //
    // ⚠️ A correção é DESLOCAR, e não estreitar: um painel mais estreito
    // cortaria o texto de dentro, que é o que se foi ler. Ele encosta na
    // margem direita e continua com a largura que precisa.
    const largura = Math.max(r.width, LARGURA_MINIMA);
    const maxWidth = Math.max(160, window.innerWidth - 2 * MARGEM);
    const left = Math.max(
      MARGEM,
      Math.min(r.left, window.innerWidth - MARGEM - Math.min(largura, maxWidth)),
    );

    setBox(
      cabeEmbaixo
        ? { top: r.bottom + 6, left, width: r.width, maxWidth, paraCima: false }
        : {
            bottom: window.innerHeight - r.top + 6,
            left,
            width: r.width,
            maxWidth,
            paraCima: true,
          },
    );
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onDown(e: MouseEvent) {
      const alvo = e.target as Node;
      if (
        !anchorRef.current?.contains(alvo) &&
        !panelRef.current?.contains(alvo)
      ) {
        onClose();
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [isOpen, onClose]);

  return { anchorRef, panelRef, box };
}

/**
 * A caixa animada. Quem chama põe as opções dentro.
 *
 * ⚠️ AS LINHAS DE DENTRO ENTRAM EM CASCATA: use `PANEL_ITEM` como `variants`
 * de cada filho. 18ms de atraso, curto de propósito — menu é onde ninguém
 * quer esperar.
 */
export const PANEL_ITEM = {
  fechado: { opacity: 0, y: -4 },
  aberto: { opacity: 1, y: 0 },
};

export default function AnchoredPanel({
  box,
  panelRef,
  role = "listbox",
  "aria-label": ariaLabel,
  minWidth,
  children,
}: {
  box: PanelBox;
  panelRef: MutableRefObject<HTMLDivElement | null>;
  role?: "listbox" | "menu";
  "aria-label": string;
  /** Por padrão acompanha a largura do gatilho. */
  minWidth?: number;
  children: ReactNode;
}) {
  return (
    <motion.div
      ref={panelRef}
      role={role}
      aria-label={ariaLabel}
      initial={{ opacity: 0, y: box.paraCima ? 6 : -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: box.paraCima ? 6 : -6, scale: 0.97 }}
      transition={{ type: "spring", duration: 0.26, bounce: 0 }}
      style={{
        position: "fixed",
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        minWidth: Math.min(minWidth ?? box.width, box.maxWidth),
        maxWidth: box.maxWidth,
        zIndex: 60,
        transformOrigin: box.paraCima ? "bottom left" : "top left",
        maxHeight: "min(50vh, 320px)",
        overflowY: "auto",
        borderRadius: 12,
        padding: 6,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow)",
      }}
    >
      <motion.div
        initial="fechado"
        animate="aberto"
        variants={{
          aberto: { transition: { staggerChildren: 0.018 } },
          fechado: {},
        }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
