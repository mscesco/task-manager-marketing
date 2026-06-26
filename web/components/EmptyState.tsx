import type { ReactNode } from "react";

/**
 * Estado vazio reutilizável (Spec 018 / Fatia A1).
 * Substitui os 6 empty states inline que existiam em Board, membros,
 * projetos, arquivadas e minhas-tarefas.
 *
 * - `title`        sempre presente
 * - `description`  opcional (texto ou nó)
 * - `action`       opcional (ex.: botão "Limpar filtros" / "+ Nova tarefa")
 *
 * Visual herdado do padrão antigo: borda tracejada, raio 12 (rounded-lg),
 * padding 40 (p-10), centralizado, largura máx. 480.
 */
export default function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="max-w-[480px] rounded-lg border border-dashed border-border p-10 text-center">
      <p className="font-semibold">{title}</p>
      {description ? (
        <p className={`mt-1.5 text-base text-ink-faint ${action ? "mb-3.5" : "mb-0"}`}>
          {description}
        </p>
      ) : null}
      {action}
    </div>
  );
}
