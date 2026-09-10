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

export type PanelBox = {
  readonly top?: number;
  readonly bottom?: number;
  readonly left: number;
  readonly width: number;
  readonly paraCima: boolean;
};

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
    setBox(
      cabeEmbaixo
        ? { top: r.bottom + 6, left: r.left, width: r.width, paraCima: false }
        : {
            bottom: window.innerHeight - r.top + 6,
            left: r.left,
            width: r.width,
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
      transition={{ type: "spring", duration: 0.26, bounce: 0.16 }}
      style={{
        position: "fixed",
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        minWidth: minWidth ?? box.width,
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
