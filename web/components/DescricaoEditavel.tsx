"use client";
// components/DescricaoEditavel.tsx
// A descrição da tarefa, editável no lugar (Spec 052, fatia D).
//
// O gesto é o do Trello, pedido por ela em 16/09: "Descrição" com um botão
// **Editar** ao lado, que só edita a descrição. O texto vira campo com
// Salvar e Cancelar; **clicar fora salva**, **Ctrl+Enter salva**, **Esc
// desiste**.
//
// ⚠️ ENTER NÃO SALVA AQUI (ao contrário do título): descrição tem parágrafos,
// e o Enter é a quebra de linha. O atalho de salvar é o mesmo do resto do
// produto (`ehAtalhoDeSalvar`).
//
// ⚠️ A FATIA C (Markdown) TROCA O MIOLO DESTE COMPONENTE: o `linkify` vira o
// renderizador, e o `textarea` ganha a barra e o "Visualizar". O gesto de
// abrir, salvar e desistir fica.

import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { decidirDescricao } from "@/lib/edicaoNoLugar";
import { linkify } from "@/lib/linkify";
import { ehAtalhoDeSalvar } from "@/lib/teclasFormulario";
import { useSairDoBloco } from "@/lib/useSairDoBloco";

export default function DescricaoEditavel({
  valor,
  onSalvar,
}: {
  valor: string | null;
  /** Grava a descrição nova. ⚠️ Em erro, LANÇA com a mensagem pronta. */
  onSalvar: (nova: string) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [emVoo, setEmVoo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const blocoRef = useRef<HTMLDivElement | null>(null);
  const campoRef = useRef<HTMLTextAreaElement | null>(null);
  // Mesma guarda do `TituloEditavel`: clicar num campo de fora dispara
  // `mousedown` E `focusout`, e só o primeiro pode confirmar.
  const abertoRef = useRef(false);
  const idDoRotulo = useId();

  const texto = emVoo ?? valor ?? "";
  const temTexto = texto.trim().length > 0;

  // O foco vai para o FIM do texto, e não seleciona tudo: na descrição a
  // pessoa quase sempre acrescenta, e com tudo selecionado a primeira tecla
  // apagaria a descrição inteira.
  useEffect(() => {
    const el = campoRef.current;
    if (!editando || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editando]);

  function abrir() {
    if (emVoo !== null) return;
    setRascunho(valor ?? "");
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
    const decisao = decidirDescricao(rascunho, valor);
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
      setErro(e instanceof Error ? e.message : "Não consegui salvar a descrição.");
      setRascunho(decisao.valor);
      abertoRef.current = true;
      setEditando(true);
    } finally {
      setEmVoo(null);
    }
  }

  useSairDoBloco(blocoRef, editando, () => void confirmar());

  // ⚠️ `preventDefault` no `mousedown` dos botões do bloco: o foco fica no
  // campo. Sem isto, no Safari (onde botão não recebe foco) o clique em
  // "Cancelar" ainda sairia do campo -- e o que sai do bloco salva.
  const manterFoco = (e: ReactMouseEvent) => e.preventDefault();

  return (
    <div className="field">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span className="label" id={idDoRotulo}>
          Descrição
        </span>
        {!editando && temTexto && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={abrir}
            disabled={emVoo !== null}
            aria-label="Editar descrição"
            style={{ padding: "2px 10px", fontSize: 13 }}
          >
            Editar
          </button>
        )}
      </div>

      {editando ? (
        <div ref={blocoRef} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea
            ref={campoRef}
            className="input"
            aria-labelledby={idDoRotulo}
            value={rascunho}
            rows={6}
            maxLength={100_000}
            placeholder="Detalhes, contexto, links…"
            aria-invalid={erro ? true : undefined}
            onChange={(e) => setRascunho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                // ⚠️ Só desiste da descrição -- o Esc do detalhe fecharia o modal.
                e.preventDefault();
                e.stopPropagation();
                desistir();
                return;
              }
              if (ehAtalhoDeSalvar(e)) {
                e.preventDefault();
                e.stopPropagation();
                void confirmar();
              }
            }}
            style={{ resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
          />
          {erro && (
            <div className="error-box" role="alert">
              {erro}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-primary"
              onMouseDown={manterFoco}
              onClick={() => void confirmar()}
            >
              Salvar
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onMouseDown={manterFoco}
              onClick={desistir}
            >
              Cancelar
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              Ctrl+Enter salva · Esc cancela
            </span>
          </div>
        </div>
      ) : temTexto ? (
        // linkify: URL http/https vira <a>. Descricao NAO passa pelo parser de
        // mencao/gif -- esses tokens so existem em comentario.
        // overflowWrap: URL longa SEM hifen (so barras/underscore) nao tem ponto
        // de quebra natural e vazaria a largura do modal.
        <div
          style={{
            fontSize: 14,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            opacity: emVoo !== null ? 0.6 : 1,
          }}
        >
          {linkify(texto, "desc-")}
        </div>
      ) : (
        // ⚠️ SEM DESCRIÇÃO, O CONVITE É O ALVO -- não há "Editar" para editar o
        // nada. Um botão de verdade (Tab, Enter), com cara de área vazia.
        <button
          type="button"
          onClick={abrir}
          className="w-full rounded-md text-left hover:bg-[var(--surface-2)]"
          style={{
            font: "inherit",
            fontSize: 13,
            border: "1px dashed var(--border)",
            padding: "10px 12px",
            color: "var(--text-faint)",
            cursor: "pointer",
          }}
        >
          Adicionar uma descrição…
        </button>
      )}
    </div>
  );
}
