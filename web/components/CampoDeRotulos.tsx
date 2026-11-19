"use client";
// Categoria (uma) ou tags (várias) do projeto: as pílulas escolhidas e o painel
// de escolha da Base (`EditorDeEscolha`), que busca e cria ao digitar.

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import Badge from "@/components/Badge";
import { useAnchoredPanel } from "@/components/AnchoredPanel";
import EditorDeEscolha from "@/components/bases/EditorDeEscolha";
import { useAvisar } from "@/components/Toasts";
import {
  createProjectLabel,
  listProjectLabels,
  type ApiError,
  type ProjectLabel,
  type ProjectLabelKind,
} from "@/lib/api";
import { corDaOpcao, proximaCor } from "@/lib/baseTable";

/** A pílula de uma categoria ou tag, com a cor dela. */
export function SeloDeRotulo({ rotulo }: { rotulo: ProjectLabel }) {
  return (
    <Badge tone="soft" size="sm" weight="semibold" forma="etiqueta" color={corDaOpcao(rotulo.color)}>
      {rotulo.name}
    </Badge>
  );
}

export default function CampoDeRotulos({
  kind,
  titulo,
  teamId,
  valor,
  onChange,
  desabilitado,
}: {
  kind: ProjectLabelKind;
  /** O nome do campo ("Categoria", "Tags"): rótulo do botão e do painel. */
  titulo: string;
  /** O time do projeto: o catálogo é o da raiz dele. */
  teamId: string;
  valor: ProjectLabel[];
  onChange: (v: ProjectLabel[]) => void;
  desabilitado?: boolean;
}) {
  const multiplo = kind === "tags";
  const avisar = useAvisar();
  const [aberto, setAberto] = useState(false);
  // `null` = ainda não buscado; busca ao abrir a primeira vez.
  const [catalogo, setCatalogo] = useState<ProjectLabel[] | null>(null);
  const fecharRef = useRef<(() => void) | null>(null);
  // Na escolha única o editor grava logo após criar, antes de o `catalogo` novo renderizar.
  const criados = useRef<ProjectLabel[]>([]);
  const fechar = () => setAberto(false);
  const { anchorRef, panelRef, box } = useAnchoredPanel<HTMLDivElement>(aberto, () =>
    fecharRef.current ? fecharRef.current() : fechar(),
  );

  function abrir() {
    setAberto(true);
    if (catalogo === null) {
      listProjectLabels(kind, teamId)
        .then(setCatalogo)
        .catch((e: ApiError) => {
          avisar(e.message || "Não consegui carregar a lista.");
          setAberto(false);
        });
    }
  }

  return (
    <div ref={anchorRef} className="flex min-h-8 flex-wrap items-center gap-1.5">
      {valor.map((r) => (
        <SeloDeRotulo key={r.id} rotulo={r} />
      ))}
      <button
        type="button"
        className="btn btn-ghost text-xs"
        disabled={desabilitado}
        onClick={abrir}
        aria-label={valor.length ? `Trocar ${titulo.toLowerCase()}` : `Escolher ${titulo.toLowerCase()}`}
      >
        <Plus size={13} aria-hidden="true" />
        {valor.length ? "Trocar" : "Escolher"}
      </button>
      {aberto && box && catalogo && (
        <EditorDeEscolha
          box={box}
          panelRef={panelRef}
          fecharRef={fecharRef}
          titulo={titulo}
          opcoes={catalogo.map((r) => ({ id: r.id, rotulo: r.name, cor: corDaOpcao(r.color) }))}
          selecionados={valor.map((r) => r.id)}
          multiplo={multiplo}
          podeCriar
          onCriar={async (nome) => {
            try {
              const novo = await createProjectLabel(kind, {
                team_id: teamId,
                name: nome,
                color: proximaCor(catalogo.map((r) => r.color)),
              });
              criados.current.push(novo);
              setCatalogo((c) => [...(c ?? []), novo]);
              return novo.id;
            } catch (e) {
              avisar((e as ApiError).message || "Não consegui criar.");
              return null;
            }
          }}
          onGravar={(ids) => {
            const porId = new Map(
              [...catalogo, ...criados.current, ...valor].map((r) => [r.id, r]),
            );
            onChange(ids.map((id) => porId.get(id)).filter((r): r is ProjectLabel => !!r));
          }}
          onFechar={() => {
            fecharRef.current = null;
            fechar();
          }}
        />
      )}
    </div>
  );
}
