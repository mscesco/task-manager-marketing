import type { ReactNode } from "react";

/**
 * Card de conteúdo (Spec 018 / Fatia A4) — chrome puro.
 * Fundo surface + borda + raio 12 + padding 20 canônicos.
 *
 * NÃO engole comportamento: é um container estilizado. Cards com
 * drag (TaskCard) ou link (`<a>` de projeto) NÃO usam este primitivo —
 * ficam pra fatia visual, quando o Board/cards é tocado com intenção.
 *
 * Layout do conteúdo (flex/gap), margem externa e max-width vêm via
 * `className` (ex.: "flex flex-col gap-3 mb-4 max-w-[860px]").
 */
export default function Card({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-lg border border-border bg-surface p-5 ${className}`.trim()}>
      {children}
    </div>
  );
}
