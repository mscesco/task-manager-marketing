// Spec 052, fatia E -- o editor que já mostra formatado, testado SEM tela
// (o Tiptap roda sobre o jsdom).
//
// O que ele prende:
//   - ⭐ o briefing de uma solicitação abre e volta com as MESMAS quebras;
//   - ⭐ `- ` vira lista, `1. ` vira numerada, `## ` vira título, `**x**` vira
//     negrito -- ao digitar, como no Trello;
//   - ⚠️ Ctrl+Enter NÃO quebra linha (é o atalho de salvar); Shift+Enter quebra;
//   - a quebra é salva como `\n`, e não com dois espaços;
//   - ⭐⚠️ NADA do texto salvo some ao editar (código, citação, tabela, imagem...);
//   - ⚠️ `javascript:` não vira link;
//   - `pareceMarkdown` e `colarComoMarkdown`: o que é lido como Markdown ao colar.

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import {
  colarComoMarkdown,
  extensoesDaDescricao,
  markdownDoEditor,
  pareceMarkdown,
} from "@/lib/editorDeDescricao";

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

  /** Abre, EDITA (um espaço no fim) e devolve o que seria salvo. */
  function editarESalvar(markdown: string): string {
    const e = editor(markdown);
    e.commands.insertContentAt(e.state.doc.content.size - 1, " ");
    return markdownDoEditor(e);
  }

  it("⭐⚠️ NADA SOME AO EDITAR -- o que a revisão de 16/09 mediu sumindo", () => {
    // Cada caso: o texto salvo, e o que PRECISA continuar nele depois de editar.
    const casos: [string, string[]][] = [
      ["Senha do wifi: `Fecaf@2026` na recepção", ["`Fecaf@2026`"]],
      ["```\ncódigo importante\n```", ["```", "código importante"]],
      ["> citação importante", ["> citação importante"]],
      ["linha com ~~risco~~", ["~~risco~~"]],
      ["antes\n\n---\n\ndepois", ["---"]],
      ["- [ ] pendente\n- [x] feita", ["[ ] pendente", "[x] feita"]],
      ["![logo](https://x.com/y.png) legenda", ["https://x.com/y.png", "logo"]],
      [
        "| Item | Valor |\n|---|---|\n| Cota | R$ 550 mil |",
        ["| Item | Valor |\n|---|---|\n| Cota | R$ 550 mil |"],
      ],
    ];
    for (const [salvo, precisa] of casos) {
      const depois = editarESalvar(salvo);
      for (const trecho of precisa) expect(depois, `de: ${salvo}`).toContain(trecho);
    }
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

describe("colarComoMarkdown -- quem cola: o Markdown ou o HTML", () => {
  const md = "## Objetivo\n\n- um\n- dois";

  it("⭐ texto puro que parece Markdown: lê como Markdown", () => {
    expect(colarComoMarkdown(md, null)).toBe(true);
  });

  it("⭐⚠️ Markdown do VS Code (HTML só de div/span ao lado): lê como Markdown", () => {
    const htmlDoVsCode =
      '<meta charset="utf-8"><div style="color:#d4d4d4"><div><span style="color:#569cd6">## Objetivo</span></div><div><span>- um</span></div></div>';
    expect(colarComoMarkdown(md, htmlDoVsCode)).toBe(true);
  });

  it("HTML com formatação de verdade (Docs, Trello, página): fica com o editor", () => {
    expect(colarComoMarkdown(md, "<h2>Objetivo</h2><ul><li>um</li></ul>")).toBe(false);
    expect(colarComoMarkdown(md, '<p>veja <b>isto</b></p>')).toBe(false);
  });

  it("texto que não parece Markdown nunca é lido como Markdown", () => {
    expect(colarComoMarkdown("Conta: 2 * 3 * 4", null)).toBe(false);
  });
});
