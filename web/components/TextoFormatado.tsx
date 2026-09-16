"use client";
// components/TextoFormatado.tsx
// A descrição de projeto e de tarefa desenhada com formatação (Spec 052, fatia C).
//
// ⚠️ É O ÚNICO LUGAR QUE TRANSFORMA DESCRIÇÃO EM ELEMENTOS. Quem precisa desenhar
// uma descrição usa este componente, e não chama o `react-markdown` direto: a
// lista do que é permitido e a regra de endereço moram em `lib/markdown.ts`, e
// uma segunda chamada seria uma segunda lista para esquecer de atualizar.
//
// O que ele faz (spec §4.3):
//   - `remark-gfm`: listas e URL solta vira link (o que o `linkify` fazia);
//   - `remark-breaks`: ⚠️ QUEBRA DE LINHA SIMPLES VIRA QUEBRA. Sem isso, as
//     descrições que já existem -- e o briefing das solicitações, que é feito
//     de linhas curtas -- virariam um parágrafo só no dia do deploy;
//   - HTML escrito à mão aparece como TEXTO (sem `rehype-raw`, de propósito);
//   - link só `http`, `https` e `mailto`, sempre em aba nova.
//
// ⚠️ TÍTULO NUNCA COMPETE COM A PÁGINA: `#` e `##` saem como `<h3>`, e `###` em
// diante como `<h4>`. A descrição mora embaixo do título da tarefa (`<h2>`) e
// do nome do projeto (`<h1>`).

import Markdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { ELEMENTOS_PERMITIDOS, enderecoSeguro } from "@/lib/markdown";

const PLUGINS = [remarkGfm, remarkBreaks];

const COMPONENTES: Components = {
  a({ href, children }) {
    const url = enderecoSeguro(href);
    // ⚠️ Endereço recusado vira TEXTO, e não `<a>` sem destino: o clique não
    // pode fazer nada inesperado, e o nome continua legível.
    if (!url) return <span>{children}</span>;
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h3>{children}</h3>,
  h3: ({ children }) => <h4>{children}</h4>,
  h4: ({ children }) => <h4>{children}</h4>,
  h5: ({ children }) => <h4>{children}</h4>,
  h6: ({ children }) => <h4>{children}</h4>,
  // ⚠️ IMAGEM VIRA LINK (revisão de 16/09): o editor não mostra imagem, e
  // desenhá-la aqui carregaria endereço externo na tela de quem só abre a
  // tarefa. O texto alternativo é o nome; sem ele, "imagem".
  img({ src, alt }) {
    const url = enderecoSeguro(typeof src === "string" ? src : null);
    const nome = alt || "imagem";
    if (!url) return <span>{nome}</span>;
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {nome}
      </a>
    );
  },
  // Caixa de lista de tarefas: só a marca, sem clique -- marcar aqui não salva.
  input({ type, checked }) {
    if (type !== "checkbox") return null;
    return <input type="checkbox" checked={!!checked} disabled readOnly />;
  },
};

export default function TextoFormatado({
  texto,
  className,
}: {
  texto: string;
  /** Classes a mais no bloco (o corte de linhas do "Sobre o projeto"). */
  className?: string;
}) {
  return (
    <div className={"texto-formatado" + (className ? ` ${className}` : "")}>
      <Markdown
        remarkPlugins={PLUGINS}
        allowedElements={ELEMENTOS_PERMITIDOS}
        // ⚠️ DESEMBRULHA o que não é permitido: o conteúdo fica como texto, e
        // não some junto com o elemento.
        unwrapDisallowed
        // ⚠️ E NÃO REESCREVE ENDEREÇO: `enderecoSeguro` decide no `a`, onde dá
        // para trocar o link por texto. O `urlTransform` padrão devolveria `""`,
        // e um `href=""` recarrega a página.
        urlTransform={(url) => url}
        components={COMPONENTES}
      >
        {texto}
      </Markdown>
    </div>
  );
}
