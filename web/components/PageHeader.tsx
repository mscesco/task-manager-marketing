import type { ReactNode } from "react";

import PageTitle from "@/components/PageTitle";

/**
 * Cabeçalho de página (Spec 018 / Fatia A5).
 * Substitui a linha "título + contador (+ ações)" repetida em 5 telas
 * (arquivadas, minhas-tarefas, perfil, membros, projetos).
 *
 * - `title`   título da página
 * - `count`   contador opcional ao lado (ex.: 12 / "8 tarefas")
 * - `titleAddon` o que acompanha o título SEM fazer parte dele: o lápis de
 *             renomear, o campo de edição. ⚠️ Não ponha isso no `title` --
 *             tudo dentro do `<h1>` vira o nome do título (ver `PageTitle`).
 * - `actions` opcional; passe `className="ml-auto"` no botão pra empurrar
 *             à direita (equivale ao space-between antigo)
 *
 * NÃO cobre o header do Board (é toolbar com busca/filtros) nem o de
 * projetos/[id] (header de detalhe com status) — padrões distintos.
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
    <div className={`mb-[18px] flex items-center gap-3 ${className}`.trim()}>
      {/* ⚠️ Spec 039 (F1): cabeçalho de tela = 26px / 800. Sem segunda família,
          o PESO é que faz a hierarquia -- ver a tabela em §5.2 da spec.
          O `tracking` foi mantido: apertar título é medição própria na Raleway,
          e a tabela de tracking da Notion ficou de fora (era para Inter). */}
      <PageTitle>{title}</PageTitle>
      {titleAddon}
      {count != null && count !== false && (
        <span className="text-base text-ink-faint">{count}</span>
      )}
      {actions}
    </div>
  );
}
