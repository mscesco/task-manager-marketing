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
// Fatias C e E: o texto é desenhado com formatação (`TextoFormatado`) e o campo
// é o `EditorDeDescricao`, que já mostra formatado enquanto se escreve. O gesto
// de abrir, salvar e desistir é desta fatia D e não mudou.

import { useId, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { decidirDescricao } from "@/lib/edicaoNoLugar";
import EditorDeDescricao from "@/components/EditorDeDescricaoAdiado";
import TextoFormatado from "@/components/TextoFormatado";
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
  // Mesma guarda do `TituloEditavel`: clicar num campo de fora dispara
  // `mousedown` E `focusout`, e só o primeiro pode confirmar.
  const abertoRef = useRef(false);
  const idDoRotulo = useId();

  const texto = emVoo ?? valor ?? "";
  const temTexto = texto.trim().length > 0;

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
        <div
          ref={blocoRef}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
          // ⚠️ AS TECLAS FICAM NO BLOCO, e não no campo: na aba "Visualizar" o
          // campo não existe, e o Esc e o Ctrl+Enter precisam continuar valendo.
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
        >
          <EditorDeDescricao
            valor={rascunho}
            onChange={setRascunho}
            rotuloId={idDoRotulo}
            // O cursor vai para o FIM, e não seleciona tudo: na descrição a
            // pessoa quase sempre acrescenta.
            focarAoAbrir
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
        <div style={{ opacity: emVoo !== null ? 0.6 : 1 }}>
          <TextoFormatado texto={texto} />
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
