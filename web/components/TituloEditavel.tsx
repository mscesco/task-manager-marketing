"use client";
// O título da tarefa, editável no lugar: Enter salva, clicar fora salva, Esc desiste.
// `textarea` para o título longo quebrar linha; a regra do que salvar mora em `lib/edicaoNoLugar.ts`.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { decidirTitulo, TITULO_MAXIMO_TAREFA } from "@/lib/edicaoNoLugar";

const ESTILO_DO_TITULO = {
  fontSize: 22,
  fontWeight: 700,
  letterSpacing: "-0.02em",
  lineHeight: 1.27,
} as const;

export default function TituloEditavel({
  valor,
  onSalvar,
  level = "h2",
  compacto = false,
}: {
  valor: string;
  /** `h1` quando a tarefa é a página inteira; `h2` no painel e no modal. */
  level?: "h1" | "h2";
  /** Até duas linhas, com reticências; o texto inteiro aparece ao editar. */
  compacto?: boolean;
  /** Grava o título novo. Em erro, lança com a mensagem pronta para a tela. */
  onSalvar: (novo: string) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(valor);
  // O texto indo ao servidor, mostrado no lugar do título para não piscar o velho.
  const [emVoo, setEmVoo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const campoRef = useRef<HTMLTextAreaElement | null>(null);
  // "Já confirmei ou desisti": o campo saindo da tela ainda dispara o blur, que confirmaria de novo.
  // Ref, e não estado, porque o blur chega antes do novo render.
  const abertoRef = useRef(false);

  // `focus()` e depois `select()`: `select()` sozinho não move o foco no jsdom.
  useEffect(() => {
    if (!editando) return;
    campoRef.current?.focus();
    campoRef.current?.select();
  }, [editando]);

  useLayoutEffect(() => {
    const el = campoRef.current;
    if (!editando || !el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editando, rascunho]);

  function abrir() {
    if (emVoo !== null) return;
    setRascunho(valor);
    setErro(null);
    abertoRef.current = true;
    setEditando(true);
  }

  function desistir() {
    if (!abertoRef.current) return;
    abertoRef.current = false;
    setEditando(false);
    setErro(null);
  }

  async function confirmar() {
    if (!abertoRef.current) return;
    abertoRef.current = false;
    const decisao = decidirTitulo(rascunho, valor);
    setEditando(false);
    if (decisao.tipo === "nada") {
      setErro(null);
      return;
    }
    setEmVoo(decisao.valor);
    try {
      await onSalvar(decisao.valor);
      setErro(null);
    } catch (e) {
      // Reabre com o que a pessoa escreveu.
      setErro(e instanceof Error ? e.message : "Não consegui salvar o título.");
      setRascunho(decisao.valor);
      abertoRef.current = true;
      setEditando(true);
    } finally {
      setEmVoo(null);
    }
  }

  const Heading = level;

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {editando ? (
        // O campo fica dentro do título, que não some durante a edição (`textarea` é válido em `h1`/`h2`).
        <Heading style={{ margin: 0 }}>
          <textarea
            ref={campoRef}
            className="input"
            aria-label="Título da tarefa"
            value={rascunho}
            maxLength={TITULO_MAXIMO_TAREFA}
            rows={1}
            aria-invalid={erro ? true : undefined}
            onChange={(e) => setRascunho(e.target.value)}
            onBlur={() => void confirmar()}
            onKeyDown={(e) => {
              // `stopPropagation`: o Esc do detalhe fecharia o modal inteiro.
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                desistir();
                return;
              }
              // Enter de composição (acento, IME) ainda não é o Enter da pessoa.
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.stopPropagation();
                void confirmar();
              }
            }}
            style={{
              ...ESTILO_DO_TITULO,
              width: "100%",
              padding: "2px 6px",
              margin: "-3px -7px",
              resize: "none",
              overflow: "hidden",
              fontFamily: "inherit",
            }}
          />
        </Heading>
      ) : (
        <Heading style={{ ...ESTILO_DO_TITULO, margin: 0, overflowWrap: "anywhere" }}>
          {/* Botão dentro do título, e não `<h2 onClick>`: alcançável por Tab e anuncia que edita. */}
          <button
            type="button"
            onClick={abrir}
            // Sem `aria-label`: o nome do botão é o título; a instrução vai no `title`.
            title="Editar o título"
            className={`w-full rounded-md text-left hover:bg-[var(--surface-2)] ${
              compacto ? "line-clamp-2" : ""
            }`}
            style={{
              font: "inherit",
              letterSpacing: "inherit",
              color: "inherit",
              border: "none",
              padding: "2px 6px",
              margin: "-2px -6px",
              cursor: emVoo !== null ? "progress" : "pointer",
              opacity: emVoo !== null ? 0.6 : 1,
              overflowWrap: "anywhere",
            }}
          >
            {emVoo ?? valor}
          </button>
        </Heading>
      )}
      {erro && (
        <div className="mt-1 text-xs text-danger" role="alert">
          {erro}
        </div>
      )}
    </div>
  );
}
