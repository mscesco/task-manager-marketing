"use client";
// components/TeamParamReader.tsx
// Quem lê `?time=` da URL e o entrega para cima — Spec 048, fatia C.
//
// ⚠️⚠️ ESTE COMPONENTE EXISTE POR CAUSA DE UMA ARMADILHA DO NEXT, e não porque
// ler uma query mereça um arquivo.
//
// `useSearchParams` num componente cliente de rota PRÉ-RENDERIZADA derruba o
// `next build` com *"missing suspense boundary with useSearchParams"* -- e o
// `npm run dev` NÃO reclama (`AGENTS.md` §6, registrado duas vezes). Das telas
// deste produto, as cinco que a fatia C recorta são estáticas (`○` no build).
//
// ⚠️⚠️ E O `AppShell` NÃO PODE CHAMAR `useSearchParams` DIRETO. O padrão que já
// existe aqui é a PÁGINA envolver o conteúdo em `Suspense` com
// `fallback={<AppShell><Loading /></AppShell>}` (ver `app/quadro/page.tsx`) --
// ou seja, o `AppShell` é renderizado DENTRO do fallback. Um `useSearchParams`
// nele quebraria o próprio fallback, e a saída seria pôr fronteira nas doze
// páginas e tirar a barra de todos os fallbacks (tela em branco no HTML
// estático da página que 26 pessoas abrem todo dia).
//
// Então a fronteira mora AQUI, num componente que:
//   - não desenha nada (`return null`), logo o `fallback={null}` não pisca;
//   - é IRMÃO do conteúdo, não ancestral, logo nada remonta quando a query
//     resolve -- a alternativa (envolver a barra + `children` no `Suspense`)
//     montaria, desmontaria e remontaria as telas, e com elas os `fetch`.
//
// ⚠️ O PREÇO, dito com clareza: no primeiro render o `AppShell` não sabe a
// query, e `activeTeam` cai na reserva (`fromUrl: false`, o time em que a
// pessoa trabalha). Depois da hidratação o valor chega e o parâmetro ganha.
// Isso é CORRETO no HTML estático -- ali não existe query nenhuma para ler --
// e o caso em que difere é link colado apontando para outro time, que troca de
// destaque uma vez, sem remontar a tela.

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function TeamParamReader({
  onSearch,
}: {
  /** Recebe a query INTEIRA (`?a=1&time=x`), e não só o time. */
  onSearch: (search: string) => void;
}) {
  const params = useSearchParams();
  // ⚠️ A STRING, e não o objeto: `useSearchParams` devolve uma instância nova a
  // cada render, e usá-la como dependência rodaria o efeito para sempre.
  const search = params.toString();

  useEffect(() => {
    onSearch(search);
    // ⚠️ `onSearch` FORA DAS DEPENDÊNCIAS de propósito. O chamador passa o
    // `setState` (identidade estável), mas uma função inline no JSX seria nova
    // a cada render do pai -- e como este efeito CHAMA um setter do pai, isso
    // seria um laço. Depender só de `search` deixa o laço impossível de
    // escrever por acidente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return null;
}
