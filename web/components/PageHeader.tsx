import type { ReactNode } from "react";

import PageTitle from "@/components/PageTitle";

/**
 * Cabeçalho de página: título + contador + ações.
 * `titleAddon` acompanha o título sem entrar no `<h1>` (lápis de renomear, campo
 * de edição): tudo dentro do `<h1>` vira o nome do título. Para empurrar uma
 * ação à direita, `className="ml-auto"` nela.
 */
export default function PageHeader({
  title,
  titleAddon,
  count,
  actions,
  className = "",
}: {
  title: ReactNode;
  titleAddon?: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    // `flex-wrap`: ações que não cabem descem de linha em vez de espremer o título.
    <div className={`mb-[18px] flex flex-wrap items-center gap-3 ${className}`.trim()}>
      <PageTitle>{title}</PageTitle>
      {titleAddon}
      {count != null && count !== false && (
        <span className="text-base text-ink-faint">{count}</span>
      )}
      {actions}
    </div>
  );
}
