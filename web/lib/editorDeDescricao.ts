// Configuração do editor de descrição (Tiptap) que mostra o texto formatado,
// e as regras testáveis sem tela. O que se guarda é Markdown, desenhado pelo
// `TextoFormatado`; o componente `EditorDeDescricao` só monta isto.

import { Extension, type AnyExtension, type Editor } from "@tiptap/core";
import HardBreak from "@tiptap/extension-hard-break";
import Link from "@tiptap/extension-link";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { enderecoSeguro } from "@/lib/markdown";

/**
 * Quebra de linha: escrita como `
` (o `TextoFormatado` usa `remark-breaks`),
 * e Ctrl+Enter não quebra porque é o atalho de salvar.
 */
const QuebraDeLinha = HardBreak.extend({
  renderMarkdown: () => "\n",
  addKeyboardShortcuts() {
    return { "Shift-Enter": () => this.editor.commands.setHardBreak() };
  },
});

/**
 * Link com a mesma regra do renderizador. `isAllowedUri` não cobre o link que
 * vem do Markdown salvo; por isso a leitura também recusa (fica o texto).
 */
const LinkSeguro = Link.extend({
  parseMarkdown: (token, helpers) => {
    const filhos = helpers.parseInline(token.tokens || []);
    if (enderecoSeguro(token.href) === null) return filhos;
    return helpers.applyMark("link", filhos, { href: token.href, title: token.title || null });
  },
}).configure({
  // Clicar editando posiciona o cursor, para dar para corrigir o link.
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  defaultProtocol: "https",
  isAllowedUri: (url) => enderecoSeguro(url) !== null,
});

/** O editor não mostra imagem: ela vira link com o texto alternativo, para o
 *  endereço não se perder ao salvar. */
const ImagemComoLink = Extension.create({
  name: "imagemComoLink",
  markdownTokenName: "image",
  parseMarkdown: (token, helpers) => {
    const texto = (token.text as string) || (token.href as string) || "imagem";
    const filhos = [{ type: "text", text: texto }];
    if (enderecoSeguro(token.href as string) === null) return filhos;
    return helpers.applyMark("link", filhos, { href: token.href, title: null });
  },
});

/**
 * O editor não tem tabela: ela vira as linhas cruas separadas por quebra, e o
 * texto salvo continua sendo a mesma tabela.
 */
const TabelaComoTexto = Extension.create({
  name: "tabelaComoTexto",
  markdownTokenName: "table",
  parseMarkdown: (token) => {
    const linhas = String(token.raw ?? "").replace(/\n+$/, "").split("\n");
    const conteudo = linhas.flatMap((linha, i) =>
      i === 0 ? [{ type: "text", text: linha }] : [{ type: "hardBreak" }, { type: "text", text: linha }],
    );
    return { type: "paragraph", content: conteudo.filter((n) => n.type !== "text" || n.text) };
  },
});

/**
 * As extensões do editor. Tudo o que o Markdown salvo pode ter precisa ser
 * entendido aqui, senão some ao salvar. Sublinhado fica de fora: Markdown não
 * tem sublinhado.
 */
export function extensoesDaDescricao(): AnyExtension[] {
  return [
    StarterKit.configure({
      underline: false,
      hardBreak: false,
      link: false,
    }),
    LinkSeguro,
    QuebraDeLinha,
    TaskList,
    TaskItem.configure({ nested: true }),
    ImagemComoLink,
    TabelaComoTexto,
    Markdown.configure({
      // Linha simples do texto salvo vira quebra, não espaço.
      markedOptions: { gfm: true, breaks: true },
    }),
  ];
}

/**
 * O texto colado parece Markdown? Só então é lido como Markdown, para um `*`
 * solto (`2 * 3`) não virar itálico.
 */
export function pareceMarkdown(texto: string): boolean {
  return (
    /^\s{0,3}(#{1,6}\s|[-*+]\s+\S|\d+[.)]\s+\S|>\s)/m.test(texto) ||
    /\*\*[^*\n]+\*\*|__[^_\n]+__/.test(texto) ||
    /\[[^\]\n]+\]\((https?:|mailto:)[^)\s]+\)/.test(texto)
  );
}

/**
 * Colar como Markdown? Se o HTML ao lado traz formatação de verdade (Docs,
 * Trello), o editor cola pelo HTML. Editores como o VS Code mandam um HTML
 * sem formatação junto, e aí vale o Markdown.
 */
export function colarComoMarkdown(texto: string, html: string | null): boolean {
  if (!pareceMarkdown(texto)) return false;
  if (!html) return true;
  return !/<(strong|b|em|i|u|h[1-6]|ul|ol|li|a|blockquote|pre|code|table|img)[\s>]/i.test(html);
}

/** O Markdown que o editor tem agora. */
export function markdownDoEditor(editor: Editor): string {
  return editor.getMarkdown().trim();
}
