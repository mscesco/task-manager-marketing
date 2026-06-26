import type { ReactNode } from "react";

/**
 * Cabeçalho de página (Spec 018 / Fatia A5).
 * Substitui a linha "título + contador (+ ações)" repetida em 5 telas
 * (arquivadas, minhas-tarefas, perfil, membros, projetos).
 *
 * - `title`   título da página
 * - `count`   contador opcional ao lado (ex.: 12 / "8 tarefas")
 * - `actions` opcional; passe `className="ml-auto"` no botão pra empurrar
 *             à direita (equivale ao space-between antigo)
 *
 * NÃO cobre o header do Board (é toolbar com busca/filtros) nem o de
 * projetos/[id] (header de detalhe com status) — padrões distintos.
 */
export default function PageHeader({
  title,
  count,
  actions,
  className = "",
}: {
  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-[18px] flex items-center gap-3 ${className}`.trim()}>
      <h1 className="text-[19px] tracking-[-0.02em]">{title}</h1>
      {count != null && count !== false && (
        <span className="text-base text-ink-faint">{count}</span>
      )}
      {actions}
    </div>
  );
}
