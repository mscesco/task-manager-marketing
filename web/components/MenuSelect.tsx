"use client";
// components/MenuSelect.tsx
// Escolher um item de uma lista — Spec 047, revisão de 09/09.
//
// ⚠️⚠️ ELE SUBSTITUI O `<select>` NATIVO nos dois pontos em que a Camila
// apontou: *"esse seletor aqui do escolha o time ou de adicionar membro, quero
// igual o que você acabou de fazer do rodapé"*. É o mesmo desenho e a mesma
// animação do `ContextSwitcher`.
//
// ⚠️ E NÃO É SÓ ESTÉTICA: o `<select>` nativo desenha a lista pelo sistema
// operacional — fonte, cores e tamanho vêm do Windows, não do produto. Numa
// gaveta escura ele aparece branco, e nada no CSS alcança aquilo. Já o menu
// próprio também cabe uma DICA por linha ("(área)", "3 pessoas"), coisa que
// `<option>` não suporta em lugar nenhum.
//
// ⚠️ O PAINEL É `fixed`, e não `absolute`: as gavetas rolam por dentro
// (`overflow-y-auto`), e um painel `absolute` seria RECORTADO por elas. Por
// medir na abertura, ele FECHA ao rolar ou redimensionar.
//
// ⚠️ E ABRE PARA CIMA quando não há espaço embaixo. Sem isso, o menu de
// "adicionar membro" — que fica no pé de uma gaveta — nasceria fora da tela.
//
// ⚠️ MORA EM `components/`, então tem guardião: `app/` fica fora do `include`
// do vitest.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown } from "lucide-react";

export type MenuOption<T extends string> = {
  readonly id: T;
  readonly label: string;
  /** Texto apagado à direita — o que `<option>` nunca permitiu. */
  readonly hint?: string;
};

/** Quanto o painel precisa de espaço embaixo para não virar para cima. */
const ESPACO_MINIMO = 220;

export default function MenuSelect<T extends string>({
  value,
  options,
  placeholder,
  disabled = false,
  "aria-label": ariaLabel,
  onSelect,
}: {
  value: T | null;
  options: readonly MenuOption<T>[];
  placeholder: string;
  disabled?: boolean;
  "aria-label": string;
  onSelect: (id: T) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [caixa, setCaixa] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
  } | null>(null);
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);

  const atual = options.find((o) => o.id === value) ?? null;

  // ⚠️ `useLayoutEffect` e não `useEffect`: medir depois da PINTURA faria o
  // painel aparecer um quadro no canto (0,0) e saltar para o lugar.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const r = gatilhoRef.current?.getBoundingClientRect();
    if (!r) return;
    const cabeEmbaixo = window.innerHeight - r.bottom > ESPACO_MINIMO;
    setCaixa(
      cabeEmbaixo
        ? { top: r.bottom + 6, left: r.left, width: r.width }
        : {
            bottom: window.innerHeight - r.top + 6,
            left: r.left,
            width: r.width,
          },
    );
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onDown(e: MouseEvent) {
      const alvo = e.target as Node;
      if (
        !gatilhoRef.current?.contains(alvo) &&
        !painelRef.current?.contains(alvo)
      ) {
        setIsOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }
    const fechar = () => setIsOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("resize", fechar);
    window.addEventListener("scroll", fechar, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("resize", fechar);
      window.removeEventListener("scroll", fechar, true);
    };
  }, [isOpen]);

  const paraCima = caixa?.bottom !== undefined;

  return (
    <>
      {/* ⚠️ `.input` no gatilho: ele OCUPA O LUGAR de um campo de formulário,
          então tem de parecer um. O que muda é só a lista que ele abre. */}
      <button
        ref={gatilhoRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setIsOpen((v) => !v)}
        className="input flex w-full items-center gap-2 text-left text-sm"
      >
        <span className={`min-w-0 flex-1 truncate ${atual ? "" : "muted"}`}>
          {atual ? atual.label : placeholder}
        </span>
        {atual?.hint && (
          <span className="muted shrink-0 text-xs">{atual.hint}</span>
        )}
        <motion.span
          className="inline-flex shrink-0"
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ type: "spring", duration: 0.3, bounce: 0.2 }}
        >
          <ChevronDown size={15} aria-hidden="true" />
        </motion.span>
      </button>

      {/* ⚠️ `AnimatePresence` é o que permite a SAÍDA animada: sem ele o React
          desmonta o nó na hora e o `exit` nunca roda. */}
      <AnimatePresence>
        {isOpen && caixa && (
          <motion.div
            ref={painelRef}
            role="listbox"
            aria-label={ariaLabel}
            initial={{ opacity: 0, y: paraCima ? 6 : -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: paraCima ? 6 : -6, scale: 0.97 }}
            transition={{ type: "spring", duration: 0.26, bounce: 0.16 }}
            style={{
              position: "fixed",
              top: caixa.top,
              bottom: caixa.bottom,
              left: caixa.left,
              minWidth: caixa.width,
              zIndex: 60,
              // A escala nasce do lado do gatilho — do centro, o painel
              // cresceria para os dois lados e pareceria brotar do nada.
              transformOrigin: paraCima ? "bottom left" : "top left",
              maxHeight: "min(50vh, 320px)",
              overflowY: "auto",
              borderRadius: 12,
              padding: 6,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow)",
            }}
          >
            {/* ⚠️ AS LINHAS ENTRAM EM CASCATA, com 18ms de atraso. Curto de
                propósito: menu é onde ninguém quer esperar. */}
            <motion.div
              initial="fechado"
              animate="aberto"
              variants={{
                aberto: { transition: { staggerChildren: 0.018 } },
                fechado: {},
              }}
            >
              {options.length === 0 && (
                <div className="muted px-2 py-2 text-xs">Nada para escolher.</div>
              )}
              {options.map((o) => {
                const selecionada = o.id === value;
                return (
                  <motion.div
                    key={o.id}
                    variants={{
                      fechado: { opacity: 0, y: paraCima ? 4 : -4 },
                      aberto: { opacity: 1, y: 0 },
                    }}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={selecionada}
                      onClick={() => {
                        setIsOpen(false);
                        onSelect(o.id);
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium ${
                        selecionada
                          ? "bg-accent-soft text-accent"
                          : "text-ink-soft hover:bg-surface-2"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {o.hint && (
                        <span className="muted shrink-0 text-xs">{o.hint}</span>
                      )}
                      {selecionada && (
                        <Check size={14} aria-hidden="true" className="shrink-0" />
                      )}
                    </button>
                  </motion.div>
                );
              })}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
