"use client";
// O painel suspenso, ancorado a um gatilho. Regras:
//   1. `fixed`, não `absolute`: gavetas e barra lateral rolam por dentro e
//      recortariam o painel.
//   2. Mede o gatilho ao abrir, por isso fecha ao rolar ou redimensionar.
//   3. Abre para cima quando não há espaço embaixo.
//   4. Clique fora se testa com `contains`, não `target === currentTarget`.
//   5. A escala nasce do lado do gatilho.
//   6. Não sai pela direita: desloca para caber, e ainda se mede depois de
//      desenhado. A borda é a da página (`clientWidth`), sem a barra de rolagem.
// `bounce: 0` porque qualquer overshoot faz a caixa passar do tamanho e voltar.

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

/** A largura útil da página, sem a barra de rolagem vertical. Sem medida (o
 *  jsdom diz 0), cai na da janela. */
function larguraDaPagina(): number {
  return document.documentElement.clientWidth || window.innerWidth;
}

export type PanelBox = {
  readonly top?: number;
  readonly bottom?: number;
  readonly left: number;
  readonly width: number;
  /** Teto de largura, para o painel caber na janela. */
  readonly maxWidth: number;
  readonly paraCima: boolean;
  /** O painel cresce a partir da borda DIREITA do gatilho (ver `alinhar`). */
  readonly alinhadoADireita: boolean;
};

/** Largura assumida no cálculo de borda quando o gatilho é estreito. */
const LARGURA_MINIMA = 220;

export function useAnchoredPanel<T extends HTMLElement>(
  isOpen: boolean,
  onClose: () => void,
  opcoes: {
    /** Largura real do painel, quando passa de `LARGURA_MINIMA`. */
    larguraPainel?: number;
    /** De que lado do gatilho o painel se alinha. Padrão: `esquerda`. */
    alinhar?: "esquerda" | "direita";
    /**
     * Submenu: abre ao lado do item (à direita; sem espaço, à esquerda),
     * alinhado pelo topo e subindo o necessário para caber.
     */
    aoLado?: boolean;
    /**
     * Elementos que contam como "dentro" para o clique-fora e a rolagem; é o
     * que mantém o menu principal aberto enquanto se usa o submenu.
     */
    dentro?: readonly MutableRefObject<HTMLElement | null>[];
  } = {},
): {
  anchorRef: MutableRefObject<T | null>;
  panelRef: MutableRefObject<HTMLDivElement | null>;
  box: PanelBox | null;
} {
  const anchorRef = useRef<T | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<PanelBox | null>(null);

  // `useLayoutEffect`: medir depois da pintura faria o painel piscar em (0,0).
  useLayoutEffect(() => {
    if (!isOpen) return;
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    if (opcoes.aoLado) {
      const largura = opcoes.larguraPainel ?? LARGURA_MINIMA;
      const maxWidth = Math.max(160, window.innerWidth - 2 * MARGEM);
      const cabeADireita = r.right + 4 + largura <= window.innerWidth - MARGEM;
      const left = cabeADireita ? r.right + 4 : Math.max(MARGEM, r.left - 4 - largura);
      // 320 é o teto de altura do painel (o `maxHeight` lá embaixo).
      const top = Math.max(MARGEM, Math.min(r.top - 6, window.innerHeight - MARGEM - 320));
      setBox({ top, left, width: largura, maxWidth, paraCima: false, alinhadoADireita: !cabeADireita });
      return;
    }
    const cabeEmbaixo = window.innerHeight - r.bottom > ESPACO_MINIMO;

    // Para não sair pela direita, desloca em vez de estreitar (estreitar
    // cortaria o texto de dentro).
    const largura = Math.max(r.width, opcoes.larguraPainel ?? LARGURA_MINIMA);
    const maxWidth = Math.max(160, larguraDaPagina() - 2 * MARGEM);
    const alinhadoADireita = opcoes.alinhar === "direita";
    // Pela direita: a borda direita do painel encosta na do gatilho, e ele
    // cresce para a esquerda. As duas travas de janela valem igual.
    const inicio = alinhadoADireita
      ? r.right - Math.min(largura, maxWidth)
      : r.left;
    const left = Math.max(
      MARGEM,
      Math.min(inicio, larguraDaPagina() - MARGEM - Math.min(largura, maxWidth)),
    );

    setBox(
      cabeEmbaixo
        ? {
            top: r.bottom + 6,
            left,
            width: r.width,
            maxWidth,
            paraCima: false,
            alinhadoADireita,
          }
        : {
            bottom: window.innerHeight - r.top + 6,
            left,
            width: r.width,
            maxWidth,
            paraCima: true,
            alinhadoADireita,
          },
    );
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const dentroDeOutro = (alvo: Node) =>
      (opcoes.dentro ?? []).some((ref) => ref.current?.contains(alvo));
    function onDown(e: MouseEvent) {
      const alvo = e.target as Node;
      if (
        !anchorRef.current?.contains(alvo) &&
        !panelRef.current?.contains(alvo) &&
        !dentroDeOutro(alvo)
      ) {
        onClose();
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Marca o Esc como usado: o modal de baixo (detalhe, criar tarefa) só
      // fecha com Esc que ninguém de dentro usou.
      e.preventDefault();
      onClose();
    }
    // O ouvinte de captura recebe também a rolagem do próprio painel, que não
    // deve fechá-lo. `instanceof Node` antes do `contains`: a rolagem da janela
    // chega com `Window` como alvo, e `contains(window)` levanta `TypeError`.
    function onScroll(e: Event) {
      const alvo = e.target;
      if (alvo instanceof Node && (panelRef.current?.contains(alvo) || dentroDeOutro(alvo))) return;
      onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [isOpen, onClose]);

  return { anchorRef, panelRef, box };
}

/** `variants` de cada linha do painel, para entrarem em cascata. */
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
  /** `dialog` quando o painel tem mais que opções (ex.: busca). */
  role?: "listbox" | "menu" | "dialog";
  "aria-label": string;
  /** Por padrão acompanha a largura do gatilho. */
  minWidth?: number;
  children: ReactNode;
}) {
  // Regra 6: quanto ainda andar para a esquerda depois de medido. `offsetWidth`
  // porque `getBoundingClientRect` mede a caixa escalada pela animação.
  const [ajuste, setAjuste] = useState(0);
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const borda = larguraDaPagina() - MARGEM;
    const sobra = box.left + el.offsetWidth - borda;
    setAjuste(sobra > 0 ? -Math.min(sobra, box.left - MARGEM) : 0);
  }, [box.left, panelRef]);
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
        left: box.left + ajuste,
        minWidth: Math.min(minWidth ?? box.width, box.maxWidth),
        maxWidth: box.maxWidth,
        zIndex: 60,
        // Regra 5.
        transformOrigin: `${box.paraCima ? "bottom" : "top"} ${
          box.alinhadoADireita ? "right" : "left"
        }`,
        maxHeight: "min(50vh, 320px)",
        overflowY: "auto",
        // Camada própria: sem isto cada quadro da escala redesenha o conteúdo
        // (a grade de emojis travava).
        willChange: "transform, opacity",
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
