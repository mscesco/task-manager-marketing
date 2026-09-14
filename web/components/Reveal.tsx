"use client";
// components/Reveal.tsx
// Um bloco que ABRE e FECHA animado — Spec 047, revisão de 09/09.
//
// ⚠️⚠️ ELE EXISTE PORQUE AS GAVETAS APARECIAM AOS SALTOS. Confirmação de
// "tirar", formulário de "adicionar a um time", linha de consequência +
// Salvar: tudo nascia e sumia de uma vez, e o conteúdo abaixo pulava. A
// Camila: *"quero incluir animações em grande parte das coisas, principalmente
// para entrada e saída de informações"*.
//
// ⚠️ ANIMA `height: auto`, que é o ponto e é o que só o motion faz direito:
// em CSS puro, `height` não interpola de/para `auto` — a saída seca é o
// motivo de metade das transições de acordeão do mundo serem feias. O motion
// mede o conteúdo e interpola de verdade.
//
// ⚠️ `overflow: hidden` NÃO É COSMÉTICO: sem ele, o conteúdo transborda a
// caixa enquanto ela ainda está encolhendo, e a saída fica pior que nenhuma
// animação.
//
// ⚠️ `prefers-reduced-motion` já é honrado pelo bloco global do `globals.css`,
// e o `motion` respeita a mesma media query por conta própria.

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

export default function Reveal({
  show,
  children,
}: {
  show: boolean;
  children: ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ type: "spring", duration: 0.3, bounce: 0 }}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
