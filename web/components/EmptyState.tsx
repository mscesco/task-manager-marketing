import type { ReactNode } from "react";

/**
 * Estado vazio reutilizável.
 *
 * - `title`        sempre presente
 * - `description`  opcional (texto ou nó)
 * - `action`       opcional (ex.: botão "Limpar filtros" / "+ Nova tarefa")
 *
 * Borda tracejada, raio 12, padding 40, centralizado, largura máx. 480.
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
    <div className="mx-auto max-w-[480px] rounded-lg border border-dashed border-border p-10 text-center">
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
