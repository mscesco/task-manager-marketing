// Spec 052, fatia E -- o editor que já mostra formatado, testado SEM tela
// (o Tiptap roda sobre o jsdom).
//
// O que ele prende:
//   - ⭐ o briefing de uma solicitação abre e volta com as MESMAS quebras;
//   - ⭐ `- ` vira lista, `1. ` vira numerada, `## ` vira título, `**x**` vira
//     negrito -- ao digitar, como no Trello;
//   - ⚠️ Ctrl+Enter NÃO quebra linha (é o atalho de salvar); Shift+Enter quebra;
//   - a quebra é salva como `\n`, e não com dois espaços;
//   - ⚠️ citação, código e risco não existem no editor;
//   - ⚠️ `javascript:` não vira link;
//   - `pareceMarkdown`: o que é lido como Markdown ao colar, e o que não é.

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { extensoesDaDescricao, markdownDoEditor, pareceMarkdown } from "@/lib/editorDeDescricao";

let abertos: Editor[] = [];
afterEach(() => {
  abertos.forEach((e) => e.destroy());
  abertos = [];
});

function editor(markdown = ""): Editor {
  const e = new Editor({
    extensions: extensoesDaDescricao(),
    content: markdown,
    contentType: "markdown",
  });
  abertos.push(e);
  return e;
}

/** Digita como uma pessoa: cada caractere passa pelas regras de digitação. */
function digitar(e: Editor, texto: string) {
  for (const ch of texto) {
    const { from, to } = e.state.selection;
    const tratado = e.view.someProp("handleTextInput", (f) =>
      f(e.view, from, to, ch, () => e.state.tr.insertText(ch, from, to)),
    );
    if (!tratado) e.view.dispatch(e.state.tr.insertText(ch, from, to));
  }
}

function tecla(e: Editor, key: string, extra: Partial<KeyboardEventInit> = {}) {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
  e.view.someProp("handleKeyDown", (f) => f(e.view, ev));
}

describe("ida e volta do texto salvo", () => {
  it("⭐ o briefing de uma solicitação volta com as mesmas quebras", () => {
    const briefing = [
      "Arte do CBV",
      "Solicitante: Maria · 11 99999-0000",
      "Protocolo: AB12CD34 · Recebida em 16/09/2026",
      "",
      "Qual o formato?",
      "Post 1080x1080",
      "",
      "Prazo",
      "20/09",
    ].join("\n");
    const e = editor(briefing);
    // Linha simples é QUEBRA dentro do parágrafo, e não um parágrafo novo.
    expect(e.getJSON().content).toHaveLength(3);
    expect(markdownDoEditor(e)).toBe(briefing);
  });

  it("⚠️ a quebra é salva como \\n, sem os dois espaços da padrão", () => {
    expect(markdownDoEditor(editor("um\ndois"))).toBe("um\ndois");
  });

  it("negrito, itálico, listas, título e link voltam como Markdown", () => {
    const md = "**neg** e *it*\n\n- a\n- b\n\n1. um\n2. dois\n\n## Título\n\n[Pasta](https://drive.google.com/x)";
    expect(markdownDoEditor(editor(md))).toBe(md);
  });

  it("⚠️ citação, código e risco não existem no editor -- o texto fica", () => {
    const e = editor("> cita\n\n`cod` ~~risco~~");
    const tipos = JSON.stringify(e.getJSON());
    expect(tipos).not.toMatch(/blockquote|"code"|strike/);
    expect(e.getText()).toContain("cita");
    expect(e.getText()).toContain("risco");
  });
});

describe("⭐ formatar ao digitar, como no Trello", () => {
  it("\"- \" vira lista", () => {
    const e = editor();
    digitar(e, "- item");
    expect(e.getJSON().content?.[0].type).toBe("bulletList");
    expect(markdownDoEditor(e)).toBe("- item");
  });

  it("\"1. \" vira lista numerada", () => {
    const e = editor();
    digitar(e, "1. um");
    expect(e.getJSON().content?.[0].type).toBe("orderedList");
    expect(markdownDoEditor(e)).toBe("1. um");
  });

  it("\"## \" vira título", () => {
    const e = editor();
    digitar(e, "## Objetivo");
    expect(e.getJSON().content?.[0].type).toBe("heading");
  });

  it("**texto** vira negrito, e os asteriscos somem da tela", () => {
    const e = editor();
    digitar(e, "um **dois** ");
    expect(e.getText()).toBe("um dois ");
    expect(markdownDoEditor(e)).toBe("um **dois**");
  });
});

describe("teclas", () => {
  it("⚠️ Ctrl+Enter NÃO quebra linha -- é o salvar", () => {
    const e = editor("texto");
    e.commands.focus("end");
    tecla(e, "Enter", { ctrlKey: true });
    // ⚠️ OLHA O DOCUMENTO, e não o Markdown: `markdownDoEditor` apara as pontas,
    // e a quebra no fim sumiria da comparação -- medido: com o Ctrl+Enter
    // quebrando, a primeira versão deste teste passava.
    expect(JSON.stringify(e.getJSON())).not.toContain("hardBreak");
  });

  it("Shift+Enter quebra a linha", () => {
    const e = editor("texto");
    e.commands.focus("end");
    tecla(e, "Enter", { shiftKey: true });
    digitar(e, "mais");
    expect(markdownDoEditor(e)).toBe("texto\nmais");
  });
});

describe("links", () => {
  it("⚠️ javascript: não vira link", () => {
    const e = editor("[x](javascript:alert(1))");
    expect(JSON.stringify(e.getJSON())).not.toContain("javascript:");
  });

  it("link bom continua link", () => {
    const e = editor("[Pasta](https://drive.google.com/x)");
    expect(JSON.stringify(e.getJSON())).toContain("https://drive.google.com/x");
  });
});

describe("pareceMarkdown -- o que é lido como Markdown ao colar", () => {
  it("⭐ listas, títulos, negrito e link com nome", () => {
    expect(pareceMarkdown("## Objetivo\ntexto")).toBe(true);
    expect(pareceMarkdown("Itens:\n- um\n- dois")).toBe(true);
    expect(pareceMarkdown("1. um\n2. dois")).toBe(true);
    expect(pareceMarkdown("isso é **importante**")).toBe(true);
    expect(pareceMarkdown("[Pasta](https://drive.google.com/x)")).toBe(true);
  });

  it("⚠️ texto comum não -- conta, nome de arquivo, e-mail, URL solta", () => {
    expect(pareceMarkdown("Investimento: R$ 550 mil/ano\n2 * 3 = 6")).toBe(false);
    expect(pareceMarkdown("arquivo_final_v2.png maria_silva@x.com")).toBe(false);
    expect(pareceMarkdown("https://drive.google.com/drive/folders/1X7GB")).toBe(false);
    expect(pareceMarkdown("-5 graus")).toBe(false);
  });
});
