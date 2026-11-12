"use client";
// Lê a query da URL e a entrega ao `AppShell`. Existe porque `useSearchParams` em rota
// pré-renderizada exige `Suspense` (o `next build` quebra, o dev não), e o `AppShell` já é
// desenhado dentro dos fallbacks das páginas. Não desenha nada e é irmão do conteúdo, para
// nada remontar; no primeiro render o `AppShell` ainda não sabe a query.

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function TeamParamReader({
  onSearch,
}: {
  /** Recebe a query inteira (`?a=1&time=x`), não só o time. */
  onSearch: (search: string) => void;
}) {
  const params = useSearchParams();
  // A string, não o objeto: `useSearchParams` devolve instância nova a cada render.
  const search = params.toString();

  useEffect(() => {
    onSearch(search);
    // `onSearch` fora das dependências: uma função inline do pai faria um laço.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return null;
}
