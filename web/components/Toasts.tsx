"use client";
// Avisos flutuantes empilhados como cartas: só o do topo aparece inteiro.
// `layout` do motion anima o recuo das cartas; `aria-live="polite"` anuncia o aviso no leitor de tela.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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

/** A fila de avisos. `avisar` em `useCallback`: entra em dependência de efeito nas telas. */
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
    // O mais novo fica no fim do array e no topo da pilha.
    setToasts((atuais) => [...atuais, { id: proximoId.current++, text }]);
  }, []);

  return { toasts, avisar, dispensar };
}

const AvisarContext = createContext<((text: string) => void) | null>(null);

/**
 * A pilha única do app, montada no `AppShell`: quem avisa muitas vezes fecha logo
 * depois, e uma pilha dentro dele desmontaria junto com o aviso.
 */
export function AvisosProvider({ children }: { children: ReactNode }) {
  const { toasts, avisar, dispensar } = useToasts();
  return (
    <AvisarContext.Provider value={avisar}>
      {children}
      <Toasts toasts={toasts} onDismiss={dispensar} />
    </AvisarContext.Provider>
  );
}

const NAO_AVISA = () => {};

/** Põe um aviso na pilha do app. Sem `AvisosProvider` por cima não avisa nada (testes precisam do provider). */
export function useAvisar(): (text: string) => void {
  return useContext(AvisarContext) ?? NAO_AVISA;
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
      // Centro inferior com `left-1/2` + `-translate-x-1/2`: a largura é fluida.
      className="pointer-events-none fixed bottom-4 left-1/2 z-[70] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2"
      // Altura fixa: as cartas são `absolute`, e sem ela a caixa colapsaria.
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
  // Temporizador por carta: um único na fila derrubaria o mais novo junto com o mais velho.
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
      className="pointer-events-auto absolute bottom-0 left-0 right-0 flex items-center gap-2 rounded-lg border border-border bg-surface p-3 shadow-[var(--shadow)]"
    >
      {/* Espaço do X à esquerda também, para o texto centrar de verdade. */}
      <span aria-hidden="true" className="w-5 shrink-0" />
      <span className="min-w-0 flex-1 text-center text-xs leading-relaxed">
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
