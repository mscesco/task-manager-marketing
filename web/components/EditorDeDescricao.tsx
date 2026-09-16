"use client";
// components/EditorDeDescricao.tsx
// O campo de descrição com barra de formatação e "Visualizar" (Spec 052, fatia C).
//
// Decisão 3 dela: *"pode ser como recomenda"* -- o campo continua sendo TEXTO,
// com uma barra acima (negrito, itálico, título, lista, lista numerada, link),
// os atalhos Ctrl+B, Ctrl+I e Ctrl+K, e duas abas, "Escrever" e "Visualizar".
// Não é editor visual (spec §6).
//
// ⚠️ CONTROLADO, como o `EditorDeLinks`: quem usa guarda o texto e decide quando
// salvar. São três lugares -- a descrição no detalhe da tarefa, o modal de
// criar tarefa e o painel de editar projeto --, cada um com o seu jeito de
// salvar.
//
// ⚠️ O QUE CADA BOTÃO ESCREVE mora em `lib/markdown.ts` (`aplicarNaSelecao`),
// com teste. Aqui só se lê a seleção do campo e se devolve o foco.

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { Bold, Heading2, Italic, Link2, List, ListOrdered } from "lucide-react";
import TextoFormatado from "@/components/TextoFormatado";
import { acaoDoAtalho, aplicarNaSelecao, type AcaoDaBarra } from "@/lib/markdown";

const BOTOES: { acao: AcaoDaBarra; rotulo: string; icone: ReactNode }[] = [
  { acao: "negrito", rotulo: "Negrito (Ctrl+B)", icone: <Bold size={15} aria-hidden /> },
  { acao: "italico", rotulo: "Itálico (Ctrl+I)", icone: <Italic size={15} aria-hidden /> },
  { acao: "titulo", rotulo: "Cabeçalho", icone: <Heading2 size={15} aria-hidden /> },
  { acao: "lista", rotulo: "Lista", icone: <List size={15} aria-hidden /> },
  { acao: "numerada", rotulo: "Lista numerada", icone: <ListOrdered size={15} aria-hidden /> },
  { acao: "link", rotulo: "Link (Ctrl+K)", icone: <Link2 size={15} aria-hidden /> },
];

export default function EditorDeDescricao({
  valor,
  onChange,
  id,
  rotuloId,
  campoRef,
  onKeyDown,
  rows = 6,
  desabilitado = false,
  placeholder = "Detalhes, contexto, links…",
  maxLength = 100_000,
}: {
  valor: string;
  onChange: (novo: string) => void;
  /** `id` do campo, para um `<label htmlFor>` de fora. */
  id?: string;
  /** `id` do rótulo que nomeia o campo (`aria-labelledby`). */
  rotuloId?: string;
  /** Para quem usa pôr o foco no campo (a descrição no detalhe, ao abrir). */
  campoRef?: MutableRefObject<HTMLTextAreaElement | null>;
  /** Teclas que não são da barra seguem para quem usa (Esc, Ctrl+Enter). */
  onKeyDown?: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  rows?: number;
  desabilitado?: boolean;
  placeholder?: string;
  maxLength?: number;
}) {
  const [aba, setAba] = useState<"escrever" | "visualizar">("escrever");
  const campo = useRef<HTMLTextAreaElement | null>(null);
  // A seleção que o último botão pediu. Aplicada DEPOIS de o texto novo chegar
  // ao campo: antes disso, `setSelectionRange` marcaria o texto velho.
  const selecaoPendente = useRef<[number, number] | null>(null);
  const idDoPainel = useId();

  function ligarCampo(el: HTMLTextAreaElement | null) {
    campo.current = el;
    if (campoRef) campoRef.current = el;
  }

  useLayoutEffect(() => {
    const s = selecaoPendente.current;
    const el = campo.current;
    if (!s || !el) return;
    selecaoPendente.current = null;
    el.focus();
    el.setSelectionRange(s[0], s[1]);
  }, [valor]);

  function aplicar(acao: AcaoDaBarra) {
    const el = campo.current;
    if (!el || desabilitado) return;
    const r = aplicarNaSelecao(acao, valor, el.selectionStart, el.selectionEnd);
    selecaoPendente.current = [r.inicio, r.fim];
    onChange(r.texto);
  }

  // ⚠️ `preventDefault` no `mousedown` da barra: o campo NÃO perde o foco nem a
  // seleção. Sem isto, clicar em B tiraria a seleção antes de o botão lê-la, e
  // no bloco que salva ao sair (`useSairDoBloco`) o clique pareceria saída.
  const manterFoco = (e: ReactMouseEvent) => e.preventDefault();

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <div role="tablist" aria-label="Modo da descrição" className="flex gap-1">
          {(["escrever", "visualizar"] as const).map((a) => (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={aba === a}
              aria-controls={idDoPainel}
              className="btn btn-ghost"
              style={{
                padding: "2px 10px",
                fontSize: 13,
                fontWeight: aba === a ? 700 : 500,
                color: aba === a ? "var(--text)" : undefined,
                background: aba === a ? "var(--surface-2)" : undefined,
              }}
              onClick={() => setAba(a)}
            >
              {a === "escrever" ? "Escrever" : "Visualizar"}
            </button>
          ))}
        </div>
        {aba === "escrever" && (
          <div
            role="toolbar"
            aria-label="Formatação"
            className="ml-auto flex flex-wrap items-center gap-0.5"
          >
            {BOTOES.map((b) => (
              <button
                key={b.acao}
                type="button"
                className="btn btn-ghost"
                aria-label={b.rotulo}
                title={b.rotulo}
                disabled={desabilitado}
                onMouseDown={manterFoco}
                onClick={() => aplicar(b.acao)}
                // 28px: o alvo mínimo é 24 (web/AGENTS.md §3).
                style={{ width: 28, height: 28, padding: 0, justifyContent: "center" }}
              >
                {b.icone}
              </button>
            ))}
          </div>
        )}
      </div>

      <div id={idDoPainel} role="tabpanel">
        {aba === "escrever" ? (
          <textarea
            ref={ligarCampo}
            id={id}
            className="input w-full"
            aria-labelledby={rotuloId}
            value={valor}
            rows={rows}
            maxLength={maxLength}
            placeholder={placeholder}
            disabled={desabilitado}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              const acao = acaoDoAtalho(e);
              if (acao) {
                // ⚠️ Ctrl+K no navegador vai para a barra de busca, e Ctrl+B
                // abre os favoritos no Firefox: aqui dentro, os atalhos são da
                // formatação.
                e.preventDefault();
                aplicar(acao);
                return;
              }
              onKeyDown?.(e);
            }}
            style={{ resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
          />
        ) : valor.trim() ? (
          <div
            className="rounded-md border border-border px-3 py-2.5"
            style={{ minHeight: rows * 21 + 20 }}
          >
            <TextoFormatado texto={valor} />
          </div>
        ) : (
          <p className="muted rounded-md border border-border px-3 py-2.5 text-sm">
            Nada para visualizar ainda.
          </p>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        **negrito** · *itálico* · ## título · - lista · [nome](https://…)
      </p>
    </div>
  );
}
