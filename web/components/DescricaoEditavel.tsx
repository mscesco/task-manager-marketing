"use client";
// A descrição da tarefa, editável no lugar: botão Editar, Salvar e Cancelar;
// clicar fora salva, Ctrl+Enter salva, Esc desiste. Enter é quebra de linha.
// Descrição longa para em `ALTURA_MAXIMA` com "Ver mais"; o excesso se mede
// (`scrollHeight`), porque a altura depende da formatação.

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { decidirDescricao } from "@/lib/edicaoNoLugar";
import EditorDeDescricao from "@/components/EditorDeDescricaoAdiado";
import TextoFormatado from "@/components/TextoFormatado";
import { ehAtalhoDeSalvar } from "@/lib/teclasFormulario";
import { useSairDoBloco } from "@/lib/useSairDoBloco";

/** Onde a descrição para, em pixels, antes do "Ver mais". */
const ALTURA_MAXIMA = 320;

export default function DescricaoEditavel({
  valor,
  onSalvar,
}: {
  valor: string | null;
  /** Grava a descrição nova. Em erro, lança com a mensagem pronta. */
  onSalvar: (nova: string) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [expandida, setExpandida] = useState(false);
  const [excede, setExcede] = useState(false);
  const textoRef = useRef<HTMLDivElement | null>(null);
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

  // `preventDefault` no `mousedown` dos botões: o foco fica no campo (no Safari
  // o clique em "Cancelar" sairia do campo, e sair salva).
  const manterFoco = (e: ReactMouseEvent) => e.preventDefault();

  // `useLayoutEffect`: medir depois da pintura faz a tela pular.
  useLayoutEffect(() => {
    const el = textoRef.current;
    if (!el) {
      setExcede(false);
      return;
    }
    setExcede(el.scrollHeight > ALTURA_MAXIMA + 8);
  }, [valor, editando]);

  // A largura muda a altura: remede ao redimensionar.
  useEffect(() => {
    const el = textoRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(() => {
      setExcede(el.scrollHeight > ALTURA_MAXIMA + 8);
    });
    observador.observe(el);
    return () => observador.disconnect();
  }, [valor, editando]);

  // Trocar de tarefa recolhe de novo.
  useEffect(() => {
    setExpandida(false);
  }, [valor]);

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
          // As teclas ficam no bloco: na aba "Visualizar" o campo não existe.
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              // Só desiste da descrição; o Esc do detalhe fecharia o modal.
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
            // O cursor vai para o fim, sem selecionar: a pessoa quase sempre acrescenta.
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
          <div
            ref={textoRef}
            style={
              excede && !expandida
                ? {
                    maxHeight: ALTURA_MAXIMA,
                    overflow: "hidden",
                    // A última linha some aos poucos, para o corte não parecer
                    // texto faltando.
                    maskImage:
                      "linear-gradient(to bottom, #000 78%, transparent 100%)",
                    WebkitMaskImage:
                      "linear-gradient(to bottom, #000 78%, transparent 100%)",
                  }
                : undefined
            }
          >
            <TextoFormatado texto={texto} />
          </div>
          {excede && (
            <button
              type="button"
              className="btn btn-ghost"
              // Padding inline: o `.btn` vence o Tailwind.
              style={{ padding: "2px 0", fontSize: 13, marginTop: 4 }}
              aria-expanded={expandida}
              onClick={() => setExpandida((v) => !v)}
            >
              {expandida ? "Ver menos" : "Ver mais"}
            </button>
          )}
        </div>
      ) : (
        // Sem descrição, o convite é um botão de verdade com cara de área vazia.
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
