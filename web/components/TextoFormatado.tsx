"use client";
// Desenha a descrição (Markdown) de projeto e tarefa. Único lugar que chama o
// `react-markdown`; a lista do permitido e a regra de endereço ficam em `lib/markdown.ts`.
// `remark-breaks`: quebra simples vira quebra (descrições antigas são linhas curtas).
// HTML escrito à mão aparece como texto (sem `rehype-raw`, de propósito).
// `#`/`##` viram `<h3>` e o resto `<h4>`, para não competir com o título da página.

import Markdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { ELEMENTOS_PERMITIDOS, enderecoSeguro } from "@/lib/markdown";

const PLUGINS = [remarkGfm, remarkBreaks];

const COMPONENTES: Components = {
  a({ href, children }) {
    const url = enderecoSeguro(href);
    // Endereço recusado vira texto, não `<a>` sem destino.
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
  // Imagem vira link, para não carregar endereço externo ao abrir a tarefa.
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
        // O que não é permitido vira texto, em vez de sumir.
        unwrapDisallowed
        // Quem decide o endereço é `enderecoSeguro`; o padrão devolveria `""`, e `href=""` recarrega a página.
        urlTransform={(url) => url}
        components={COMPONENTES}
      >
        {texto}
      </Markdown>
    </div>
  );
}
