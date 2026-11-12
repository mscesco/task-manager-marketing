// A casca de `/privacidade` e `/termos`.

import type { ReactNode } from "react";

import { MolduraPublica } from "@/components/MolduraPublica";

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
        <p className="muted text-sm">Versão inicial de 09/11/2026, ainda sem revisão jurídica.</p>
        {children}
      </main>
    </MolduraPublica>
  );
}
