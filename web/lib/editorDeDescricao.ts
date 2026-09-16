// web/lib/editorDeDescricao.ts
// =====================================================================
// O editor de descrição que já mostra o texto formatado (Spec 052, fatia E).
//
// ⚠️⚠️ ELA REVOGOU A DECISÃO 3 EM 16/09, depois de usar a fatia C: *"não
// gostei dos asteriscos e afins"*. Pediu o jeito do Trello -- escrever e ver
// formatado; `- ` vira lista, `1. ` vira lista numerada; colar Markdown já
// entra formatado. O editor de texto com barra e "Visualizar" saiu.
//
// ⚠️ O QUE É GUARDADO NÃO MUDOU: continua sendo Markdown, desenhado pelo
// `TextoFormatado`. Por isso não há migração, o briefing das solicitações
// continua sendo lido igual, e o que já existe abre formatado.
//
// Este arquivo tem a CONFIGURAÇÃO do editor (Tiptap) e as regras que dá para
// testar sem tela -- o componente `EditorDeDescricao` só a monta.
// =====================================================================

import type { AnyExtension, Editor } from "@tiptap/core";
import HardBreak from "@tiptap/extension-hard-break";
import Link from "@tiptap/extension-link";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { enderecoSeguro } from "@/lib/markdown";

/**
 * A quebra de linha simples.
 *
 * ⚠️ DUAS MUDANÇAS SOBRE A PADRÃO, as duas medidas em 16/09:
 *  - ela é escrita como `\n`, e não como `"  \n"` (dois espaços). O
 *    `TextoFormatado` usa `remark-breaks`, onde `\n` já é quebra; os dois
 *    espaços sobrariam no texto salvo, invisíveis e sem motivo.
 *  - Ctrl+Enter NÃO quebra linha. Na padrão ele quebra -- e aqui Ctrl+Enter é
 *    SALVAR (`ehAtalhoDeSalvar`). Sem isto, salvar poria uma linha em branco
 *    no fim da descrição antes de salvá-la.
 */
const QuebraDeLinha = HardBreak.extend({
  renderMarkdown: () => "\n",
  addKeyboardShortcuts() {
    return { "Shift-Enter": () => this.editor.commands.setHardBreak() };
  },
});

/**
 * O link, com a MESMA regra do renderizador.
 *
 * ⚠️ `isAllowedUri` SOZINHO NÃO BASTA -- medido em 16/09: ele barra o link
 * criado por comando e por colagem, mas o link que chega LENDO o Markdown salvo
 * (`[x](javascript:…)`) entrava no documento com o endereço intacto. Aqui a
 * leitura também recusa: o nome fica, como texto.
 */
const LinkSeguro = Link.extend({
  parseMarkdown: (token, helpers) => {
    const filhos = helpers.parseInline(token.tokens || []);
    if (enderecoSeguro(token.href) === null) return filhos;
    return helpers.applyMark("link", filhos, { href: token.href, title: token.title || null });
  },
}).configure({
  // ⚠️ Clicar num link EDITANDO posiciona o cursor, e não abre a página --
  // senão não haveria como corrigir o texto de um link.
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  defaultProtocol: "https",
  isAllowedUri: (url) => enderecoSeguro(url) !== null,
});

/**
 * As extensões do editor: só o que o `TextoFormatado` desenha.
 *
 * ⚠️ O QUE FICA DE FORA é o que o renderizador não desenha (`ELEMENTOS_PERMITIDOS`
 * em `lib/markdown.ts`): citação, bloco de código, código, risco, linha,
 * sublinhado. Deixar no editor seria oferecer uma formatação que some ao salvar.
 */
export function extensoesDaDescricao(): AnyExtension[] {
  return [
    StarterKit.configure({
      blockquote: false,
      codeBlock: false,
      code: false,
      horizontalRule: false,
      strike: false,
      underline: false,
      hardBreak: false,
      heading: { levels: [1, 2, 3] },
      link: false,
    }),
    LinkSeguro,
    QuebraDeLinha,
    Markdown.configure({
      // ⚠️ `breaks: true`: linha simples do texto salvo vira QUEBRA no editor,
      // e não espaço. É o que mantém o briefing (feito de linhas curtas) com a
      // cara de hoje ao abrir para editar.
      markedOptions: { gfm: true, breaks: true },
    }),
  ];
}

/**
 * O texto colado parece Markdown?
 *
 * ⚠️ SÓ ENTÃO ele é lido como Markdown. Texto comum colado entra como texto: um
 * `*` solto numa conta (`2 * 3`) ou um `_` num nome de arquivo não pode virar
 * itálico por acaso. E colagem que traz HTML (do Docs, do Trello, de uma
 * página) nem passa por aqui -- o editor já a formata sozinho.
 */
export function pareceMarkdown(texto: string): boolean {
  return (
    /^\s{0,3}(#{1,6}\s|[-*+]\s+\S|\d+[.)]\s+\S|>\s)/m.test(texto) ||
    /\*\*[^*\n]+\*\*|__[^_\n]+__/.test(texto) ||
    /\[[^\]\n]+\]\((https?:|mailto:)[^)\s]+\)/.test(texto)
  );
}

/** O Markdown que o editor tem agora. */
export function markdownDoEditor(editor: Editor): string {
  return editor.getMarkdown().trim();
}
