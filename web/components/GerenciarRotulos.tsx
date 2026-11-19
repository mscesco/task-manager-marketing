"use client";
// Renomear, trocar a cor e apagar as categorias e tags do time raiz.
// Criar é pelo projeto (`CampoDeRotulos`); aqui só se mantém a lista.

import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import CaixaDeDialogo from "@/components/CaixaDeDialogo";
import { useAvisar } from "@/components/Toasts";
import {
  deleteProjectLabel,
  listProjectLabels,
  updateProjectLabel,
  type ApiError,
  type BaseOptionColor,
  type ProjectLabel,
  type ProjectLabelKind,
} from "@/lib/api";
import { CORES_DE_OPCAO, NOME_DA_COR, corDaOpcao } from "@/lib/baseTable";

const SECOES: { kind: ProjectLabelKind; titulo: string; nome: string }[] = [
  { kind: "categories", titulo: "Categorias", nome: "categoria" },
  { kind: "tags", titulo: "Tags", nome: "tag" },
];

export default function GerenciarRotulos({
  teamId,
  usos,
  onMudou,
  onFechar,
}: {
  /** O time olhado; o catálogo é o da raiz dele. */
  teamId: string;
  /** Quantos projetos da lista usam cada categoria ou tag (pelo id). */
  usos: ReadonlyMap<string, number>;
  /** Algo mudou: a lista de projetos precisa recarregar nomes e cores. */
  onMudou: () => void;
  onFechar: () => void;
}) {
  const avisar = useAvisar();
  const [listas, setListas] = useState<Record<ProjectLabelKind, ProjectLabel[]> | null>(null);
  const caixaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const quemAbriu = document.activeElement as HTMLElement | null;
    caixaRef.current?.focus();
    Promise.all([listProjectLabels("categories", teamId), listProjectLabels("tags", teamId)])
      .then(([categories, tags]) => setListas({ categories, tags }))
      .catch((e: ApiError) => {
        avisar(e.message || "Não consegui carregar as categorias e tags.");
        onFechar();
      });
    return () => quemAbriu?.focus?.();
  }, [teamId]); // eslint-disable-line react-hooks/exhaustive-deps

  function trocar(kind: ProjectLabelKind, novo: ProjectLabel | null, id: string) {
    setListas((l) =>
      l && {
        ...l,
        [kind]: novo
          ? l[kind].map((r) => (r.id === id ? novo : r)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
          : l[kind].filter((r) => r.id !== id),
      },
    );
    onMudou();
  }

  return (
    <CaixaDeDialogo
      ariaLabel="Categorias e tags"
      largura={520}
      caixaRef={caixaRef}
      acimaDeModal={false}
      onEsc={onFechar}
      onFundo={onFechar}
    >
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-lg font-bold">Categorias e tags</h2>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Fechar"
          onClick={onFechar}
          style={{ padding: 4, height: 28, lineHeight: 0 }}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <p className="muted mb-4 mt-1 text-xs">
        Para criar, escolha a categoria ou a tag na página do projeto e digite um nome novo.
      </p>
      {!listas ? (
        <p className="muted text-sm">Carregando…</p>
      ) : (
        SECOES.map((s) => (
          <section key={s.kind} aria-label={s.titulo} className="mb-4">
            <h3 className="m-0 mb-2 text-sm font-bold text-ink-soft">{s.titulo}</h3>
            {listas[s.kind].length === 0 ? (
              <p className="muted text-xs">Nenhuma {s.nome} ainda.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {listas[s.kind].map((r) => (
                  <LinhaDeRotulo
                    key={r.id}
                    rotulo={r}
                    nome={s.nome}
                    usos={usos.get(r.id) ?? 0}
                    kind={s.kind}
                    onTrocou={(novo) => trocar(s.kind, novo, r.id)}
                    onErro={(msg) => avisar(msg)}
                  />
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </CaixaDeDialogo>
  );
}

function LinhaDeRotulo({
  rotulo,
  nome,
  usos,
  kind,
  onTrocou,
  onErro,
}: {
  rotulo: ProjectLabel;
  nome: string;
  usos: number;
  kind: ProjectLabelKind;
  /** `null` = apagado. */
  onTrocou: (novo: ProjectLabel | null) => void;
  onErro: (msg: string) => void;
}) {
  const [texto, setTexto] = useState(rotulo.name);
  const [ocupado, setOcupado] = useState(false);

  async function gravar(patch: { name?: string; color?: BaseOptionColor }) {
    setOcupado(true);
    try {
      onTrocou(await updateProjectLabel(kind, rotulo.id, patch));
    } catch (e) {
      setTexto(rotulo.name);
      onErro((e as ApiError).message || `Não consegui salvar a ${nome}.`);
    } finally {
      setOcupado(false);
    }
  }

  function renomear() {
    const limpo = texto.trim();
    if (limpo && limpo !== rotulo.name) gravar({ name: limpo });
    else setTexto(rotulo.name);
  }

  async function apagar() {
    const efeito =
      usos === 0
        ? ""
        : kind === "categories"
          ? `\n\n${usos === 1 ? "1 projeto fica" : `${usos} projetos ficam`} sem categoria.`
          : `\n\nEla sai de ${usos === 1 ? "1 projeto" : `${usos} projetos`}.`;
    if (!window.confirm(`Apagar a ${nome} “${rotulo.name}”?${efeito}`)) return;
    setOcupado(true);
    try {
      await deleteProjectLabel(kind, rotulo.id);
      onTrocou(null);
    } catch (e) {
      onErro((e as ApiError).message || `Não consegui apagar a ${nome}.`);
      setOcupado(false);
    }
  }

  return (
    <li className="flex items-center gap-2">
      <span
        aria-hidden
        className="size-3 shrink-0 rounded-full"
        style={{ background: corDaOpcao(rotulo.color) }}
      />
      <input
        className="input min-w-0 flex-1"
        aria-label={`Nome da ${nome} ${rotulo.name}`}
        value={texto}
        maxLength={60}
        disabled={ocupado}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={renomear}
        onKeyDown={(e) => {
          if (e.key === "Enter") renomear();
          else if (e.key === "Escape" && texto !== rotulo.name) {
            // Esc desfaz a digitação; só fecha o diálogo se não havia nada a desfazer.
            e.stopPropagation();
            setTexto(rotulo.name);
          }
        }}
      />
      <select
        className="input w-[104px] shrink-0"
        aria-label={`Cor da ${nome} ${rotulo.name}`}
        value={rotulo.color}
        disabled={ocupado}
        onChange={(e) => gravar({ color: e.target.value as BaseOptionColor })}
      >
        {CORES_DE_OPCAO.map((c) => (
          <option key={c} value={c}>
            {NOME_DA_COR[c]}
          </option>
        ))}
      </select>
      <span className="w-14 shrink-0 text-right text-xs text-ink-faint max-sm:hidden" title="Projetos que usam">
        {usos === 1 ? "1 projeto" : `${usos} projetos`}
      </span>
      <button
        type="button"
        className="btn btn-ghost text-danger"
        style={{ padding: "4px 6px" }}
        aria-label={`Apagar a ${nome} ${rotulo.name}`}
        disabled={ocupado}
        onClick={apagar}
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </li>
  );
}
