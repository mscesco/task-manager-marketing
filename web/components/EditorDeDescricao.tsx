"use client";
// components/EditorDeDescricao.tsx
// O campo de descrição que já mostra o texto formatado (Spec 052, fatia E).
//
// ⚠️⚠️ SUBSTITUI O DA FATIA C. Aquele era texto com asteriscos, barra e aba
// "Visualizar"; ela usou e pediu o jeito do Trello (16/09): *"gostaria que
// ficasse como veríamos mesmo e só formatar caso cole algo em md (...) hífen
// espaço gera a lista, número e ponto e espaço também lista numérica (...) não
// gostei dos asteriscos e afins"*.
//
// Então aqui:
//   - escreve-se e VÊ-SE formatado; `- `, `1. `, `## `, `**x**` formatam ao
//     digitar (regras do Tiptap);
//   - Ctrl+B, Ctrl+I e Ctrl+K (link), e uma barra pequena com os mesmos;
//   - colar HTML (Docs, Trello, página) já entra formatado; colar texto que
//     PARECE Markdown também (`pareceMarkdown`); o resto entra como texto;
//   - Enter abre parágrafo, Shift+Enter quebra a linha.
//
// ⚠️ A INTERFACE CONTINUA SENDO MARKDOWN: `valor` e `onChange` levam o texto
// guardado. O `TextoFormatado` desenha igual, e não há migração.
//
// ⚠️ `onChange` SÓ É CHAMADO QUANDO A PESSOA EDITA. O editor reescreve o texto
// ao lê-lo (`[x]` vira `\[x\]`, `1)` vira `1.` -- medido em 16/09), e se
// abrir-e-fechar emitisse essa versão, clicar fora de uma descrição intocada a
// salvaria reescrita.

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { Placeholder } from "@tiptap/extensions";
import { Bold, Heading2, Italic, Link2, List, ListOrdered } from "lucide-react";
import { extensoesDaDescricao, markdownDoEditor, pareceMarkdown } from "@/lib/editorDeDescricao";
import { enderecoSeguro } from "@/lib/markdown";
import { completarEndereco } from "@/lib/links";

type Botao = {
  rotulo: string;
  icone: ReactNode;
  ativo: (e: Editor) => boolean;
  fazer: (e: Editor) => void;
};

const BOTOES: Botao[] = [
  {
    rotulo: "Negrito (Ctrl+B)",
    icone: <Bold size={15} aria-hidden />,
    ativo: (e) => e.isActive("bold"),
    fazer: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    rotulo: "Itálico (Ctrl+I)",
    icone: <Italic size={15} aria-hidden />,
    ativo: (e) => e.isActive("italic"),
    fazer: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    // ⚠️ "Cabeçalho", e não "Título": com "Título", o `getByLabelText(/Título/)`
    // dos testes do modal achava dois campos -- e um leitor de tela também
    // confundiria com o título da tarefa (fatia C).
    rotulo: "Cabeçalho",
    icone: <Heading2 size={15} aria-hidden />,
    ativo: (e) => e.isActive("heading"),
    fazer: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    rotulo: "Lista",
    icone: <List size={15} aria-hidden />,
    ativo: (e) => e.isActive("bulletList"),
    fazer: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    rotulo: "Lista numerada",
    icone: <ListOrdered size={15} aria-hidden />,
    ativo: (e) => e.isActive("orderedList"),
    fazer: (e) => e.chain().focus().toggleOrderedList().run(),
  },
];

export default function EditorDeDescricao({
  valor,
  onChange,
  rotuloId,
  focarAoAbrir = false,
  rows = 6,
  desabilitado = false,
  placeholder = "Detalhes, contexto, links…",
}: {
  valor: string;
  onChange: (novo: string) => void;
  /** `id` do rótulo que nomeia o campo (`aria-labelledby`). */
  rotuloId?: string;
  /** Põe o cursor no fim do texto assim que o editor existir. */
  focarAoAbrir?: boolean;
  /** Altura mínima, em linhas -- o mesmo significado do `rows` do textarea. */
  rows?: number;
  desabilitado?: boolean;
  placeholder?: string;
}) {
  // O último Markdown que ESTE editor entregou. Um `valor` diferente dele veio
  // de fora (a cópia pré-preenchida do duplicar) e precisa entrar no editor;
  // igual, é o eco do próprio `onChange`, e recarregar moveria o cursor.
  const ultimoEntregue = useRef(valor);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const [linkAberto, setLinkAberto] = useState(false);
  const [endereco, setEndereco] = useState("");
  const [erroLink, setErroLink] = useState<string | null>(null);
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor({
    // ⚠️ `false` no Next: montar no servidor quebraria a hidratação.
    immediatelyRender: false,
    // A barra mostra negrito/lista ATIVOS conforme o cursor anda.
    shouldRerenderOnTransaction: true,
    // ⚠️ SEM AS REGRAS DE COLAR do Tiptap: com elas, colar "2 * 3 * 4" virava
    // itálico no " 3 " (medido em 16/09). Colar Markdown continua formatando --
    // quem decide é o `handlePaste` abaixo, com `pareceMarkdown` --, e colar
    // HTML e link também (não dependem dessas regras).
    enablePasteRules: false,
    editable: !desabilitado,
    extensions: [...extensoesDaDescricao(), Placeholder.configure({ placeholder })],
    content: valor,
    contentType: "markdown",
    editorProps: {
      attributes: {
        class: "input texto-formatado editor-descricao",
        ...(rotuloId ? { "aria-labelledby": rotuloId } : {}),
        role: "textbox",
        "aria-multiline": "true",
        style: `min-height: ${rows * 21 + 22}px`,
      },
      handleKeyDown: (_view, e) => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
          // ⚠️ Ctrl+K no navegador vai para a barra de busca.
          e.preventDefault();
          abrirLink();
          return true;
        }
        return false;
      },
      // ⚠️ COLAR: HTML fica com o editor (ele já formata). Texto puro só é
      // lido como Markdown quando PARECE Markdown -- `2 * 3` colado não pode
      // virar itálico.
      handlePaste: (_view, e) => {
        const dados = e.clipboardData;
        const ed = editorRef.current;
        if (!dados || !ed || dados.types.includes("text/html")) return false;
        const texto = dados.getData("text/plain");
        if (!pareceMarkdown(texto)) return false;
        e.preventDefault();
        ed.commands.insertContent(texto, { contentType: "markdown" });
        return true;
      },
    },
    onCreate: ({ editor: ed }) => {
      editorRef.current = ed;
      if (focarAoAbrir) ed.commands.focus("end");
    },
    onUpdate: ({ editor: ed }) => {
      const md = markdownDoEditor(ed);
      ultimoEntregue.current = md;
      onChangeRef.current(md);
    },
  });

  useEffect(() => {
    if (!editor || valor === ultimoEntregue.current) return;
    ultimoEntregue.current = valor;
    editor.commands.setContent(valor, { contentType: "markdown", emitUpdate: false });
  }, [editor, valor]);

  useEffect(() => {
    // ⚠️ `false` NO SEGUNDO ARGUMENTO: por padrão `setEditable` emite "update"
    // -- medido em 16/09, era o `onChange` que chegava ao abrir sem ninguém
    // mexer, e fazia clicar fora salvar a descrição reescrita pelo editor.
    editor?.setEditable(!desabilitado, false);
  }, [editor, desabilitado]);

  function abrirLink() {
    const ed = editorRef.current;
    if (!ed) return;
    setEndereco((ed.getAttributes("link").href as string | undefined) ?? "");
    setErroLink(null);
    setLinkAberto(true);
  }

  function aplicarLink() {
    const ed = editorRef.current;
    if (!ed) return;
    const url = completarEndereco(endereco);
    // Vazio TIRA o link de onde o cursor está.
    if (!url) {
      ed.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinkAberto(false);
      return;
    }
    if (!enderecoSeguro(url)) {
      setErroLink("O endereço precisa começar com http:// ou https://.");
      return;
    }
    if (ed.state.selection.empty && !ed.isActive("link")) {
      // Sem seleção: o próprio endereço entra como texto do link.
      ed.chain()
        .focus()
        .insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] })
        .run();
    } else {
      ed.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    setLinkAberto(false);
  }

  // ⚠️ `preventDefault` no `mousedown` da barra: o editor não perde o foco nem
  // a seleção, e no bloco que salva ao sair (`useSairDoBloco`) o clique não
  // parece saída.
  const manterFoco = (e: ReactMouseEvent) => e.preventDefault();

  return (
    <div className="flex flex-col gap-1.5">
      <div role="toolbar" aria-label="Formatação" className="flex flex-wrap items-center gap-0.5">
        {BOTOES.map((b) => {
          const ativo = editor ? b.ativo(editor) : false;
          return (
            <button
              key={b.rotulo}
              type="button"
              className="btn btn-ghost"
              aria-label={b.rotulo}
              title={b.rotulo}
              aria-pressed={ativo}
              disabled={!editor || desabilitado}
              onMouseDown={manterFoco}
              onClick={() => editor && b.fazer(editor)}
              // 28px: o alvo mínimo é 24 (web/AGENTS.md §3).
              style={{
                width: 28,
                height: 28,
                padding: 0,
                background: ativo ? "var(--surface-2)" : undefined,
                color: ativo ? "var(--text)" : undefined,
              }}
            >
              {b.icone}
            </button>
          );
        })}
        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Link (Ctrl+K)"
          title="Link (Ctrl+K)"
          aria-pressed={editor ? editor.isActive("link") : false}
          disabled={!editor || desabilitado}
          onMouseDown={manterFoco}
          onClick={abrirLink}
          style={{ width: 28, height: 28, padding: 0 }}
        >
          <Link2 size={15} aria-hidden />
        </button>
      </div>

      {linkAberto && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input"
            aria-label="Endereço do link"
            placeholder="Cole o endereço (drive.google.com/…)"
            value={endereco}
            inputMode="url"
            autoFocus
            style={{ flex: 1, minWidth: 200, padding: "6px 10px", fontSize: 13 }}
            onChange={(e) => setEndereco(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                aplicarLink();
              } else if (e.key === "Escape") {
                // Só fecha o campo do link -- nem a descrição, nem o modal.
                e.preventDefault();
                e.stopPropagation();
                setLinkAberto(false);
                editor?.commands.focus();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: "4px 10px", fontSize: 13 }}
            onClick={aplicarLink}
          >
            Aplicar
          </button>
          {erroLink && (
            <span className="text-xs text-danger" role="alert">
              {erroLink}
            </span>
          )}
        </div>
      )}

      <EditorContent editor={editor} />
    </div>
  );
}
