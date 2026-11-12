"use client";
// Um bloco que abre e fecha animado, para o conteúdo abaixo não pular.
// Anima `height: auto` (o motion mede o conteúdo; CSS puro não interpola de/para `auto`).
// `overflow: hidden` é necessário: sem ele o conteúdo transborda enquanto a caixa encolhe.

import { AnimatePresence, motion } from "motion/react";
import { DUR } from "@/lib/motion";
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
          transition={{ type: "spring", duration: DUR[3], bounce: 0 }}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
