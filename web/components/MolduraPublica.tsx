// components/MolduraPublica.tsx
// A moldura das paginas PUBLICAS de solicitacao (`/solicitar`,
// `/solicitar/<slug>`) e o aviso que vira a pagina quando algo da errado.
//
// ⚠️ ERAM TRES MOLDURAS E DOIS AVISOS (revisao de 07/10): `Casca` em
// `app/solicitar/page.tsx` e em `FormularioSolicitacao.tsx`, inline no
// `[slug]/page.tsx`, e `Aviso` em `app/solicitar/page.tsx` e em
// `CarregaFormularioPublico.tsx` -- iguais a menos da largura.

import type { ReactNode } from "react";

/** O fundo e o respiro do produto, para nenhum estado ficar solto na tela. */
export function MolduraPublica({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas px-4 py-8">
      <div className="mx-auto max-w-[720px]">{children}</div>
    </div>
  );
}

/** O aviso que E a pagina quando algo deu errado (link quebrado, formulario
 *  vazio, nenhum publicado). `estreito`: centrado em 560px, dentro do
 *  carregador do formulario. */
export function AvisoPublico({
  titulo,
  texto,
  estreito = false,
}: {
  titulo: string;
  texto: string;
  estreito?: boolean;
}) {
  return (
    <div
      role="alert"
      className={`rounded-lg border border-border bg-surface p-5 ${
        estreito ? "mx-auto max-w-[560px]" : ""
      }`}
    >
      {/* ⚠️ `<h1>`, E NÃO `<strong>` (revisão de títulos, 21/09): este aviso É a
          página quando algo deu errado, e com `<strong>` ela ficava sem título
          nenhum -- justo para quem chegou por um link quebrado. */}
      <h1 className="m-0 mb-1.5 text-[16px] font-bold">{titulo}</h1>
      <p className="muted m-0 text-[14px] leading-normal">{texto}</p>
    </div>
  );
}
