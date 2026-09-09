"use client";
// app/times/[id]/page.tsx
// A tela de UM TIME — Spec 047, fatia C.
//
// ⚠️ A TELA INTEIRA MORA EM `components/TeamScreen.tsx`, e a página é só a
// rota. Não é organização de código: `app/` está FORA do `include` do vitest
// (§7 da spec), então tudo o que ficasse aqui perderia o guardião. É a mesma
// razão pela qual as decisões moram em `lib/`.
//
// ⚠️⚠️ E É A MESMA TELA DA `/membros`, por decisão da Camila em 09/09: *"eu
// quero que seja literalmente a mesma tela, com o toggle de subtimes e tudo"*.
// Lá o recorte é a organização (`teamId = null`); aqui, um time. Os dois
// níveis fazem as mesmas duas perguntas -- quem está aqui, e o que tem dentro.
//
// ⚠️ SEM `useSearchParams` — a rota é dinâmica (`ƒ /times/[id]`, por causa do
// `[id]`), então o `next build` passaria de qualquer forma; mas não há estado
// de URL aqui e não vale inventar um.

import { useParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import TeamScreen from "@/components/TeamScreen";

export default function TimePage() {
  const params = useParams<{ id: string }>();
  return (
    <AppShell>
      <TeamScreen teamId={params.id} />
    </AppShell>
  );
}
