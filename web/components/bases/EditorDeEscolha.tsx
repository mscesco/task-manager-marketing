"use client";
// components/bases/EditorDeEscolha.tsx
// O painel de escolher numa célula de Seleção, Seleção múltipla ou Pessoa
// (Spec 056, fatia E). Busca no topo, a lista embaixo, e -- na seleção -- criar
// a opção digitando (spec §12).
//
// ⚠️ SELEÇÃO ÚNICA GRAVA AO ESCOLHER; MÚLTIPLA GRAVA AO FECHAR. Gravar a cada
// marcação seriam várias entradas no diário para um gesto só, e o Ctrl+Z da
// fatia H desfaria uma marcação por vez.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import AnchoredPanel, { type PanelBox } from "@/components/AnchoredPanel";
import Badge from "@/components/Badge";
import type { MutableRefObject } from "react";

export type Escolha = { id: string; rotulo: string; cor?: string };

export default function EditorDeEscolha({
  box,
  panelRef,
  titulo,
  opcoes,
  selecionados,
  multiplo,
  podeCriar,
  onCriar,
  onGravar,
  onFechar,
  fecharRef,
}: {
  box: PanelBox;
  panelRef: MutableRefObject<HTMLDivElement | null>;
  titulo: string;
  opcoes: readonly Escolha[];
  selecionados: readonly string[];
  multiplo: boolean;
  /** Seleção: digitar um nome que não existe oferece criar. Pessoa: nunca. */
  podeCriar: boolean;
  onCriar?: (rotulo: string) => Promise<string | null>;
  onGravar: (ids: string[]) => void;
  onFechar: () => void;
  /**
   * ⚠️ O `useAnchoredPanel` fecha SOZINHO (Esc, clique fora, rolagem). Sem
   * isto, na seleção múltipla esse fechamento perderia as marcações: quem abre
   * o painel chama `fecharRef.current()` no `onClose` dele, e é o editor que
   * decide gravar.
   */
  fecharRef: MutableRefObject<(() => void) | null>;
}) {
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState<string[]>([...selecionados]);
  const [destaque, setDestaque] = useState(0);
  const [criando, setCriando] = useState(false);
  const buscaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    buscaRef.current?.focus();
  }, []);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return termo
      ? opcoes.filter((o) => o.rotulo.toLocaleLowerCase("pt-BR").includes(termo))
      : [...opcoes];
  }, [busca, opcoes]);

  const termo = busca.trim();
  const jaExiste = opcoes.some(
    (o) => o.rotulo.toLocaleLowerCase("pt-BR") === termo.toLocaleLowerCase("pt-BR")
  );
  const ofereceCriar = podeCriar && !!onCriar && termo.length > 0 && !jaExiste;
  const total = filtradas.length + (ofereceCriar ? 1 : 0);

  function fechar(final: string[] = marcados) {
    if (multiplo && !mesmos(final, selecionados)) onGravar(final);
    onFechar();
  }
  fecharRef.current = () => fechar();

  function escolher(id: string) {
    if (!multiplo) {
      onGravar(selecionados.includes(id) ? [] : [id]);
      onFechar();
      return;
    }
    setMarcados((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  }

  async function criar() {
    if (!onCriar || criando) return;
    setCriando(true);
    const id = await onCriar(termo);
    setCriando(false);
    if (!id) return;
    setBusca("");
    escolher(id);
  }

  return (
    <AnchoredPanel box={box} panelRef={panelRef} role="dialog" aria-label={titulo} minWidth={240}>
      <input
        ref={buscaRef}
        className="input mb-1 w-full"
        aria-label={podeCriar ? "Buscar ou criar opção" : "Buscar"}
        placeholder={podeCriar ? "Buscar ou criar…" : "Buscar…"}
        value={busca}
        onChange={(e) => {
          setBusca(e.target.value);
          setDestaque(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setDestaque((d) => Math.min(total - 1, d + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setDestaque((d) => Math.max(0, d - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (destaque < filtradas.length) escolher(filtradas[destaque].id);
            else if (ofereceCriar) criar();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            fechar();
          } else if (e.key === "Tab") {
            fechar();
          }
        }}
      />
      <ul className="m-0 flex list-none flex-col p-0" role="listbox" aria-multiselectable={multiplo}>
        {filtradas.map((o, i) => {
          const marcado = (multiplo ? marcados : selecionados).includes(o.id);
          return (
            <li
              key={o.id}
              role="option"
              aria-selected={marcado}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                i === destaque ? "bg-surface-2" : ""
              }`}
              onMouseEnter={() => setDestaque(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => escolher(o.id)}
            >
              <span className="flex w-4 shrink-0 justify-center" aria-hidden="true">
                {marcado && <Check size={14} />}
              </span>
              {o.cor ? (
                <Badge tone="soft" color={o.cor}>
                  {o.rotulo}
                </Badge>
              ) : (
                <span className="min-w-0 truncate">{o.rotulo}</span>
              )}
            </li>
          );
        })}
        {ofereceCriar && (
          <li
            role="option"
            aria-selected={false}
            className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              destaque === filtradas.length ? "bg-surface-2" : ""
            }`}
            onMouseEnter={() => setDestaque(filtradas.length)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={criar}
          >
            <Plus size={14} aria-hidden="true" />
            <span className="min-w-0 truncate">
              {criando ? "Criando…" : `Criar "${termo}"`}
            </span>
          </li>
        )}
        {total === 0 && (
          <li className="muted px-2 py-1.5 text-xs">
            {opcoes.length === 0 ? "Nenhuma opção ainda." : "Nada encontrado."}
          </li>
        )}
      </ul>
      {multiplo && (
        <div className="mt-1 flex justify-end">
          <button className="btn btn-ghost text-xs" onClick={() => fechar()}>
            Concluir
          </button>
        </div>
      )}
    </AnchoredPanel>
  );
}

function mesmos(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}
