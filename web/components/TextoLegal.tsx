// components/TextoLegal.tsx
// A casca de `/privacidade` e `/termos` (Spec 064).

import type { ReactNode } from "react";

import { MolduraPublica } from "@/components/MolduraPublica";

/** Dado que falta preencher. Fica à vista de propósito: não inventar dado da empresa. */
export function Marcador({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded bg-amber-soft px-1 font-bold text-amber">
      [A PREENCHER: {children}]
    </mark>
  );
}

export default function TextoLegal({
  titulo,
  children,
}: {
  titulo: string;
  children: ReactNode;
}) {
  return (
    <MolduraPublica>
      <main className="text-[15px] leading-relaxed break-words [&_a]:underline! [&_h2]:mb-2 [&_h2]:mt-8 [&_h2]:text-[18px] [&_h2]:font-bold [&_li]:my-1.5 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5">
        <h1 className="m-0 text-[26px] font-extrabold tracking-[-0.02em]">{titulo}</h1>
        <p className="muted text-sm">Rascunho de 09/11/2026</p>
        <div role="note" className="rounded-lg border border-border bg-surface p-4 text-sm">
          <strong>Rascunho técnico, ainda sem revisão jurídica.</strong> Este texto
          descreve o que o Oniros faz hoje, mas ainda não tem valor de documento
          oficial. Os trechos marcados dependem de dados que faltam.
        </div>
        {children}
      </main>
    </MolduraPublica>
  );
}
