"use client";
// components/LinksEditaveis.tsx
// Os links com nome da tarefa, editáveis no lugar (Spec 052, fatia D).
//
// ⚠️ POR QUE EXISTE: até a fatia D os links se editavam no modal de "Editar"
// tarefa, e esse modal saiu -- título e descrição passaram a ser editados no
// próprio detalhe, e o resto já era das pílulas. Os links precisavam de um
// lugar, e ganharam o mesmo gesto da descrição: "Editar", Salvar e Cancelar,
// clicar fora salva, Esc desiste.
//
// ⚠️ LINK COM ERRO NÃO SALVA AO CLICAR FORA: o editor fica aberto com o erro
// marcado. Fechar e jogar fora o que a pessoa digitou seria pior que insistir.
//
// Toda regra (válido, mudou, https://) continua em `lib/links.ts`.

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Plus } from "lucide-react";
import EditorDeLinks from "@/components/EditorDeLinks";
import LinksDoItem from "@/components/LinksDoItem";
import type { LinkItem } from "@/lib/api";
import {
  errosDosLinks,
  linhaVazia,
  linksParaEnviar,
  MAX_LINKS,
  passaDoTeto,
  rascunhoDe,
  temErro,
  type RascunhoLink,
} from "@/lib/links";
import { useSairDoBloco } from "@/lib/useSairDoBloco";

export default function LinksEditaveis({
  links,
  falhou,
  onTentarDeNovo,
  onSalvar,
}: {
  /**
   * Os links salvos. ⚠️ `null` = AINDA NÃO CHEGARAM (ou a busca falhou), e não
   * "sem links" -- revisão de 16/09: com `[]` no lugar, "Adicionar link" numa
   * lista que não carregou mandava só o link novo e apagava os que existiam.
   */
  links: readonly LinkItem[] | null;
  /** A busca falhou: nada de editar, e um jeito de tentar de novo. */
  falhou: boolean;
  onTentarDeNovo: () => void;
  /** Grava a lista inteira. ⚠️ Em erro, LANÇA com a mensagem pronta. */
  onSalvar: (novos: { title: string; url: string }[]) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState<RascunhoLink[]>([]);
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const blocoRef = useRef<HTMLDivElement | null>(null);
  // ⚠️ AQUI O EDITOR FICA ABERTO DURANTE O ENVIO (são várias linhas, e fechar
  // antes da resposta esconderia um erro de validação do servidor). A guarda
  // é "estou enviando", para o `mousedown` e o `focusout` do mesmo clique não
  // mandarem duas vezes.
  const enviandoRef = useRef(false);

  // Abrir sem links já traz uma linha vazia -- e o foco vai para ela.
  useEffect(() => {
    if (!editando) return;
    blocoRef.current?.querySelector("input")?.focus();
  }, [editando]);

  function abrir() {
    if (links === null) return;
    const inicial = rascunhoDe(links);
    setRascunho(inicial.length > 0 ? inicial : [linhaVazia()]);
    setTentouSalvar(false);
    setErro(null);
    setEditando(true);
  }

  function desistir() {
    if (enviandoRef.current) return;
    setEditando(false);
    setErro(null);
  }

  async function confirmar() {
    if (enviandoRef.current) return;
    setTentouSalvar(true);
    if (temErro(errosDosLinks(rascunho))) {
      setErro("Confira os links marcados.");
      return;
    }
    if (passaDoTeto(rascunho)) {
      setErro(`No máximo ${MAX_LINKS} links.`);
      return;
    }
    const envio = linksParaEnviar(links, rascunho);
    if (envio === null) {
      setEditando(false);
      setErro(null);
      return;
    }
    enviandoRef.current = true;
    setSalvando(true);
    setErro(null);
    try {
      await onSalvar(envio);
      setEditando(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui salvar os links.");
    } finally {
      enviandoRef.current = false;
      setSalvando(false);
    }
  }

  useSairDoBloco(blocoRef, editando, () => void confirmar());

  // Mesmo motivo da descrição: no Safari botão não recebe foco.
  const manterFoco = (e: ReactMouseEvent) => e.preventDefault();

  if (!editando) {
    if (links === null) {
      // Carregando: nada, para não piscar "Adicionar link" antes da lista.
      if (!falhou) return null;
      return (
        <p className="text-xs text-danger" role="alert">
          Não consegui carregar os links.{" "}
          <button type="button" className="font-semibold underline" onClick={onTentarDeNovo}>
            Tentar de novo
          </button>
        </p>
      );
    }
    if (links.length === 0) {
      return (
        <div>
          <button
            type="button"
            className="btn btn-ghost inline-flex items-center gap-1"
            onClick={abrir}
            style={{ padding: "2px 8px", fontSize: 13 }}
          >
            <Plus size={14} aria-hidden /> Adicionar link
          </button>
        </div>
      );
    }
    return (
      <div className="field">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span className="label">Links</span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={abrir}
            aria-label="Editar links"
            style={{ padding: "2px 10px", fontSize: 13 }}
          >
            Editar
          </button>
        </div>
        <LinksDoItem links={links} rotulo="Links da tarefa" />
      </div>
    );
  }

  return (
    <div className="field">
      <span className="label">Links</span>
      <div
        ref={blocoRef}
        style={{ display: "flex", flexDirection: "column", gap: 8 }}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          // ⚠️ Só desiste dos links -- o Esc do detalhe fecharia o modal.
          e.preventDefault();
          e.stopPropagation();
          desistir();
        }}
      >
        <EditorDeLinks
          valor={rascunho}
          onChange={setRascunho}
          desabilitado={salvando}
          mostrarErros={tentouSalvar}
        />
        {erro && (
          <div className="error-box" role="alert">
            {erro}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className="btn btn-primary"
            onMouseDown={manterFoco}
            onClick={() => void confirmar()}
            disabled={salvando}
          >
            {salvando ? "Salvando…" : "Salvar"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onMouseDown={manterFoco}
            onClick={desistir}
            disabled={salvando}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
