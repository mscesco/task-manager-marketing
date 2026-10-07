"use client";
// components/bases/BarraDeVisoes.tsx
// As abas das visões da Base (Spec 056, fatia F) -- "Todo o conteúdo",
// "Calendário", "Por status"... -- e o "+ Visão".
//
// ⚠️ VISÃO É COMPARTILHADA (D14): criar, renomear e apagar mexem na base de
// todo mundo. Os botões seguem os cadeados do servidor (`can_*_view`), e a
// visão padrão não se apaga (D25) -- o servidor recusa com 409, e a tela nem
// oferece.

import { useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import AnchoredPanel, { useAnchoredPanel } from "@/components/AnchoredPanel";
import Tabs from "@/components/Tabs";
import { useAvisar } from "@/components/Toasts";
import {
  ApiError,
  createBaseView,
  deleteBaseView,
  updateBaseView,
  type BaseDetail,
  type BaseView,
} from "@/lib/api";

const NOME_DO_LAYOUT: Record<BaseView["layout"], string> = {
  table: "Tabela",
  calendar: "Calendário",
  board: "Quadro",
};

export default function BarraDeVisoes({
  base,
  ativa,
  onEscolher,
  onViews,
}: {
  base: BaseDetail;
  ativa: BaseView;
  onEscolher: (id: string) => void;
  onViews: (atualizar: (v: BaseView[]) => BaseView[]) => void;
}) {
  const views = [...base.views].sort((a, b) => a.position - b.position);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Tabs
        aria-label="Visões da base"
        tabs={views.map((v) => ({ id: v.id, label: v.name }))}
        active={ativa.id}
        onSelect={onEscolher}
      />
      {(base.can_update_view || (base.can_delete_view && !ativa.is_default)) && (
        <MenuDaVisao
          baseId={base.id}
          visao={ativa}
          podeEditar={base.can_update_view}
          podeApagar={base.can_delete_view && !ativa.is_default}
          onMudou={(v) => onViews((vs) => vs.map((x) => (x.id === v.id ? v : x)))}
          onApagou={() => {
            onViews((vs) => vs.filter((x) => x.id !== ativa.id));
            onEscolher(views.find((v) => v.is_default)?.id ?? views[0].id);
          }}
        />
      )}
      {base.can_create_view && (
        <NovaVisao
          baseId={base.id}
          onCriou={(v) => {
            onViews((vs) => [...vs, v]);
            onEscolher(v.id);
          }}
        />
      )}
    </div>
  );
}

function MenuDaVisao({
  baseId,
  visao,
  podeEditar,
  podeApagar,
  onMudou,
  onApagou,
}: {
  baseId: string;
  visao: BaseView;
  podeEditar: boolean;
  podeApagar: boolean;
  onMudou: (v: BaseView) => void;
  onApagou: () => void;
}) {
  const avisar = useAvisar();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(visao.name);
  const [ocupado, setOcupado] = useState(false);
  const { anchorRef, panelRef, box } = useAnchoredPanel<HTMLButtonElement>(
    aberto,
    () => setAberto(false),
    { larguraPainel: 260 }
  );

  async function salvar() {
    const limpo = nome.trim();
    if (!limpo || limpo === visao.name) return;
    setOcupado(true);
    try {
      onMudou(await updateBaseView(baseId, visao.id, { name: limpo }));
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui renomear a visão.");
    } finally {
      setOcupado(false);
    }
  }

  async function apagar() {
    setOcupado(true);
    try {
      await deleteBaseView(baseId, visao.id);
      setAberto(false);
      onApagou();
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui apagar a visão.");
      setOcupado(false);
    }
  }

  return (
    <>
      <button
        ref={anchorRef}
        className="btn btn-ghost"
        style={{ padding: "2px 6px" }}
        aria-label={`Opções da visão ${visao.name}`}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        onClick={() => {
          setNome(visao.name);
          setAberto((a) => !a);
        }}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {aberto && box && (
        <AnchoredPanel box={box} panelRef={panelRef} role="dialog" aria-label={`Visão ${visao.name}`} minWidth={260}>
          <div className="flex flex-col gap-3 p-1">
            {podeEditar && (
              <div className="field">
                <label className="label" htmlFor={`visao-${visao.id}`}>
                  Nome
                </label>
                <input
                  id={`visao-${visao.id}`}
                  className="input"
                  value={nome}
                  disabled={ocupado}
                  onChange={(e) => setNome(e.target.value)}
                  onBlur={salvar}
                  onKeyDown={(e) => e.key === "Enter" && salvar()}
                />
              </div>
            )}
            {podeApagar && (
              <button className="btn btn-ghost justify-start text-danger" disabled={ocupado} onClick={apagar}>
                Apagar visão
              </button>
            )}
            {visao.is_default && (
              <p className="muted m-0 text-xs">A visão padrão não se apaga.</p>
            )}
          </div>
        </AnchoredPanel>
      )}
    </>
  );
}

function NovaVisao({ baseId, onCriou }: { baseId: string; onCriou: (v: BaseView) => void }) {
  const avisar = useAvisar();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [layout, setLayout] = useState<BaseView["layout"]>("table");
  const [ocupado, setOcupado] = useState(false);
  const { anchorRef, panelRef, box } = useAnchoredPanel<HTMLButtonElement>(
    aberto,
    () => setAberto(false),
    { larguraPainel: 260 }
  );

  async function criar() {
    const limpo = nome.trim() || NOME_DO_LAYOUT[layout];
    setOcupado(true);
    try {
      onCriou(await createBaseView(baseId, { name: limpo, layout }));
      setNome("");
      setLayout("table");
      setAberto(false);
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui criar a visão.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <button
        ref={anchorRef}
        className="btn btn-ghost text-sm"
        aria-haspopup="dialog"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
      >
        <Plus size={14} aria-hidden="true" /> Visão
      </button>
      {aberto && box && (
        <AnchoredPanel box={box} panelRef={panelRef} role="dialog" aria-label="Nova visão" minWidth={260}>
          <div className="flex flex-col gap-3 p-1">
            <div className="field">
              <label className="label" htmlFor="nova-visao-nome">
                Nome
              </label>
              <input
                id="nova-visao-nome"
                className="input"
                autoFocus
                value={nome}
                placeholder={NOME_DO_LAYOUT[layout]}
                onChange={(e) => setNome(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && criar()}
              />
            </div>
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
              <legend className="label mb-1">Formato</legend>
              {(Object.keys(NOME_DO_LAYOUT) as BaseView["layout"][]).map((l) => (
                <label key={l} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="formato-da-visao"
                    checked={layout === l}
                    onChange={() => setLayout(l)}
                  />
                  {NOME_DO_LAYOUT[l]}
                </label>
              ))}
            </fieldset>
            <button className="btn btn-primary" disabled={ocupado} onClick={criar}>
              {ocupado ? "Criando…" : "Criar visão"}
            </button>
          </div>
        </AnchoredPanel>
      )}
    </>
  );
}
