import type { ReactNode } from "react";

/**
 * Card de conteúdo: só o chrome (surface, borda, raio 12, padding 20).
 * Cards com arraste ou link não usam este primitivo.
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
