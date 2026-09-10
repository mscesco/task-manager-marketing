"use client";
// components/Toasts.tsx
// Avisos empilhados no canto — Spec 047, revisão de 10/09.
//
// ⚠️⚠️ ELES SUBSTITUEM O AVISO INLINE, que era uma linha de texto com um
// botão "Entendi" empurrando a tela para baixo. Pedido da Camila: *"toda e
// qualquer notificação de atualização, criação de membro, ou esses avisos que
// aparecem na tela (…) gostaria que aparecesse como esse stacked
// notifications"*, com o exemplo de pilha do motion.
//
// ⚠️ E o inline tinha um defeito real além da estética: ele MOVIA o conteúdo.
// A pessoa clicava em "Salvar", o aviso nascia acima da tabela e tudo descia
// uma linha — justamente enquanto ela olhava para a linha que acabou de mudar.
// A pilha flutua; nada abaixo se move.
//
// ⚠️⚠️ A PILHA É "CARTAS EMPILHADAS", e não uma lista: só o aviso do topo
// aparece inteiro, e os anteriores ficam recuados e menores atrás dele. É o
// que mantém o canto da tela pequeno quando alguém adiciona cinco pessoas
// seguidas -- uma lista de cinco tomaria metade da altura.
//
// ⚠️ `layout` do motion é o que faz o recuo ANIMAR: cada carta muda de escala
// e de deslocamento quando outra entra, e sem `layout` elas saltariam para a
// nova posição. É a "layout animation" da documentação que ela mandou.
//
// ⚠️ `aria-live="polite"` no contêiner: sem isso, quem usa leitor de tela não
// fica sabendo de nada — o aviso é a ÚNICA confirmação de que a escrita deu
// certo. `polite` e não `assertive` porque nenhum destes é urgente.
//
// ⚠️ MORA EM `components/`, então tem guardião — `app/` fica fora do
// `include` do vitest.

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";

export type Toast = {
  readonly id: number;
  readonly text: string;
};

/** Quantas cartas ficam visíveis na pilha. O resto some por baixo. */
const VISIVEIS = 3;
/** Quanto tempo cada aviso fica antes de sair sozinho. */
const VIDA_MS = 5000;

/**
 * A fila de avisos.
 *
 * ⚠️ `useCallback` no `avisar` porque ele entra em dependência de efeito nas
 * telas; recriado a cada render, dispararia o efeito em laço.
 */
export function useToasts(): {
  toasts: Toast[];
  avisar: (text: string) => void;
  dispensar: (id: number) => void;
} {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const proximoId = useRef(1);

  const dispensar = useCallback((id: number) => {
    setToasts((atuais) => atuais.filter((t) => t.id !== id));
  }, []);

  const avisar = useCallback((text: string) => {
    // ⚠️ O MAIS NOVO FICA NO FIM do array e no TOPO da pilha — ver o `map`
    // invertido no componente.
    setToasts((atuais) => [...atuais, { id: proximoId.current++, text }]);
  }, []);

  return { toasts, avisar, dispensar };
}

export default function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      aria-live="polite"
      // ⚠️ CENTRO INFERIOR, a pedido dela em 10/09. `left-1/2` +
      // `-translate-x-1/2` porque a largura é fluida (`min(...)`): centrar com
      // `right`/`left` fixos exigiria saber a largura de antemão.
      className="pointer-events-none fixed bottom-4 left-1/2 z-[70] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2"
      // ⚠️ ALTURA FIXA no contêiner: as cartas se sobrepõem em `absolute`, e
      // sem uma altura a caixa colapsaria para zero e nada apareceria.
      style={{ height: 96 }}
    >
      <AnimatePresence initial={false}>
        {toasts.slice(-VISIVEIS).map((toast, i, visiveis) => {
          // 0 = a de trás; a última é a do topo.
          const daFrente = visiveis.length - 1 - i;
          return (
            <ToastCard
              key={toast.id}
              toast={toast}
              profundidade={daFrente}
              onDismiss={onDismiss}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function ToastCard({
  toast,
  profundidade,
  onDismiss,
}: {
  toast: Toast;
  /** 0 = no topo da pilha; 1 e 2 vão ficando para trás. */
  profundidade: number;
  onDismiss: (id: number) => void;
}) {
  // ⚠️ SAI SOZINHO, e o temporizador é POR CARTA: um único timer na fila
  // derrubaria o aviso mais novo junto com o mais velho.
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), VIDA_MS);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{
        opacity: profundidade === 0 ? 1 : 0.6,
        // Cada carta atrás sobe 10px e encolhe 4% — é o "baralho".
        y: -profundidade * 10,
        scale: 1 - profundidade * 0.04,
      }}
      exit={{ opacity: 0, y: 24, scale: 0.96 }}
      transition={{ type: "spring", duration: 0.34, bounce: 0 }}
      style={{ zIndex: 10 - profundidade }}
      className="pointer-events-auto absolute bottom-0 left-0 right-0 flex items-start gap-2 rounded-lg border border-border bg-surface p-3 shadow-[var(--shadow)]"
    >
      <span className="min-w-0 flex-1 text-xs leading-relaxed">
        {toast.text}
      </span>
      <button
        type="button"
        className="btn btn-ghost shrink-0 px-1 py-0"
        aria-label="Dispensar aviso"
        onClick={() => onDismiss(toast.id)}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </motion.div>
  );
}
