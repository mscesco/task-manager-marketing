"use client";
// app/times/[id]/page.tsx
// A tela de UM TIME — Spec 047, fatia C.
//
// ⚠️ A TELA INTEIRA MORA EM `components/TeamScreen.tsx`, e a página é só a
// rota. Não é organização de código: `app/` está FORA do `include` do vitest
// (§7 da spec), então tudo o que ficasse aqui perderia o guardião. É a mesma
// razão pela qual as decisões moram em `lib/`.
//
// ⚠️⚠️ E ELA É O DESTINO DO ITEM "TIME" DO MENU, desde 09/09: a rota
// `/membros` foi removida, e a entrada passou a apontar para `/times/<área>`.
// Decisão da Camila: *"tirar o /membros e deixar 'time', e quando abrir ser o
// /times/id"*. Quem calcula qual área é `lib/contextSwitcher.ts`.
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
