import type { ReactNode } from "react";

/**
 * O `<h1>` das telas internas -- 26px / 800 (Spec 039, F1).
 *
 * ⚠️ UM LUGAR SÓ PARA O TÍTULO DA TELA (revisão de títulos, 21/09). Ele era
 * escrito três vezes: no `PageHeader` (Tailwind) e duas vezes no `Board`
 * (estilo inline, uma por ramo do modo de edição) -- três cópias do mesmo
 * tamanho, que divergiriam no primeiro ajuste.
 *
 * ⚠️ O QUE MORA DENTRO DELE VIRA O NOME DO TÍTULO para o leitor de tela. Botão
 * aqui dentro empresta o nome dele ao título; menu, lista ou formulário aqui
 * dentro viram PARTE do título (e `<div>` dentro de `<h1>` é HTML inválido).
 * Ações ficam AO LADO, não dentro -- é o que o `titleAddon` do `PageHeader` e o
 * `SeletorDeQuadro` fazem.
 *
 * As telas públicas e de conta (login, trocar senha, formulário de
 * solicitação) têm título menor de propósito, num cartão, e não usam este.
 */
export default function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="m-0 text-[26px] font-extrabold leading-[1.23] tracking-[-0.02em]">
      {children}
    </h1>
  );
}
