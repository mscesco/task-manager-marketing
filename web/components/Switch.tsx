"use client";
// components/Switch.tsx
// O interruptor de UM valor: ligado ou desligado (Spec 054, fatia D).
//
// ⚠️⚠️ SÃO TRÊS COISAS DIFERENTES NESTE PROJETO, e a diferença é do que cada
// uma DIZ, não de estilo:
//
//     Tabs.tsx    -> RECORTA uma lista ("Não lidas" / "Todas"). N abas, e a
//                    lista continua sendo o assunto.
//     Toggle.tsx  -> escolhe entre DOIS assuntos, com as duas palavras à
//                    vista. Uma pastilha que ANDA (`<motion.div layout />`).
//     Switch.tsx  -> liga ou desliga UM valor. Não há segunda palavra: o
//                    rótulo está fora, e o que o interruptor mostra é o
//                    estado.
//
// A Spec 054 pedia "o `Toggle` que já existe", mas ele não serve aqui: são 24
// interruptores numa grade, e um alternador de dois lados com as palavras
// dentro ocupa 320px por célula. Numa grade, o rótulo é a LINHA e a COLUNA --
// repetir "Ligado/Desligado" em cada célula seria uma parede de palavras.
//
// ⚠️ `role="switch"` num `<button>`, e não um `<input type="checkbox">`
// escondido: aqui não há formulário nem submit, o clique já É a gravação
// (D7). `aria-checked` diz o estado, e o nome acessível vem de fora
// (`aria-label`), porque a célula não tem texto próprio.
//
// ⚠️ `prefers-reduced-motion` já é honrado pelo bloco global do `globals.css`,
// e o `motion` respeita a mesma media query por conta própria.

import { motion } from "motion/react";

export default function Switch({
  checked,
  onChange,
  disabled = false,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: {
  checked: boolean;
  onChange: (proximo: boolean) => void;
  disabled?: boolean;
  "aria-label": string;
  "aria-describedby"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="tappable inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border p-0.5 disabled:opacity-50"
      style={{
        // ⚠️ AQUI MORA A ANIMAÇÃO: só o `justify-content` muda, e o `layout`
        // da pastilha interpola o resto -- o mesmo desenho do `Toggle`.
        justifyContent: checked ? "flex-end" : "flex-start",
        background: checked ? "var(--accent)" : "var(--surface-2)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <motion.span
        layout
        transition={{ type: "spring", duration: 0.25, bounce: 0.2 }}
        aria-hidden
        className="block h-4.5 w-4.5 rounded-full bg-surface"
        style={{ height: 18, width: 18, boxShadow: "var(--shadow)" }}
      />
    </button>
  );
}
