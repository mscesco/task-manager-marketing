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

import { Extension, type AnyExtension, type Editor } from "@tiptap/core";
import HardBreak from "@tiptap/extension-hard-break";
import Link from "@tiptap/extension-link";
import { TaskItem, TaskList } from "@tiptap/extension-list";
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
 * A IMAGEM vira LINK com o texto alternativo.
 *
 * ⚠️ O EDITOR NÃO MOSTRA IMAGEM, e sem isto a leitura jogava o endereço fora --
 * medido na revisão de 16/09: `![logo](https://…)` voltava como só "logo" ao
 * salvar. Como link, o endereço sobrevive e continua clicável.
 */
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
 * A TABELA vira as LINHAS DELA, como texto.
 *
 * ⚠️ O EDITOR NÃO TEM TABELA, e sem isto as linhas se juntavam numa só ao
 * salvar (medido: `| a | b |` + `|---|` + `| 1 | 2 |` virava uma linha), e a
 * tabela deixava de existir. Guardando as linhas cruas separadas por quebra, o
 * texto salvo continua sendo a MESMA tabela -- `|` e `-` não são escapados
 * pelo Markdown do Tiptap.
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
 * As extensões do editor.
 *
 * ⚠️⚠️ NADA DO QUE JÁ ESTÁ SALVO PODE SUMIR AO EDITAR (revisão de 16/09). A
 * primeira versão desligava código, citação, risco e linha "porque o
 * renderizador não desenha" -- e com isso o texto ENTRE CRASES sumia inteiro
 * ao salvar (medido: `` `Fecaf@2026` `` desaparecia). Agora o editor entende
 * tudo o que o Markdown salvo pode ter: código, bloco de código, citação, risco,
 * linha, lista de tarefas; imagem e tabela por conversão (acima). O
 * `TextoFormatado` desenha os mesmos elementos.
 *
 * Sublinhado continua de fora: Markdown não tem sublinhado, e ele sumiria ao
 * salvar.
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

/**
 * Colar este conteúdo como Markdown?
 *
 * ⚠️ HTML JUNTO NÃO QUER DIZER "JÁ FORMATADO" (revisão de 16/09). O VS Code, a
 * visualização crua do GitHub e vários editores de nota copiam o texto com um
 * HTML de `<div>`/`<span>` coloridos ao lado. Olhando só "tem HTML?", colar um
 * `.md` do VS Code trazia `## Objetivo` e `- item` literais -- os asteriscos que
 * ela pediu para sumirem.
 *
 * Então: se o HTML traz FORMATAÇÃO DE VERDADE (negrito, lista, título, link,
 * tabela...), quem cola é o editor, pelo HTML -- é o caso do Docs, do Trello,
 * de uma página. Se não traz, e o texto parece Markdown, lê-se o Markdown.
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
