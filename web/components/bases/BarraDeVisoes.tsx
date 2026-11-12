"use client";
// Abas das visões da Base e o "+" de criar. Visão é compartilhada: os botões seguem
// `can_*_view`, e a visão padrão não se apaga (o servidor recusa com 409).
// Clicar na aba já ativa abre o menu dela, duplo clique renomeia e o botão direito abre o
// menu de qualquer aba. O primeiro clique do duplo também é clique: pelo mouse o menu espera
// `ESPERA_DO_DUPLO`, e o duplo clique cancela; pelo teclado (`detail === 0`) abre na hora.
// Não usa `components/Tabs.tsx`, que não tem renomear nem menu.

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { DUR } from "@/lib/motion";
import { ChevronDown, Plus } from "lucide-react";
import AnchoredPanel, { useAnchoredPanel } from "@/components/AnchoredPanel";
import { useAvisar } from "@/components/Toasts";
import {
  ApiError,
  createBaseView,
  deleteBaseView,
  updateBaseView,
  type BaseColumn,
  type BaseDetail,
  type BaseView,
} from "@/lib/api";
import { colunasDeAgrupar, colunasDeData } from "@/lib/baseViews";

const NOME_DO_LAYOUT: Record<BaseView["layout"], string> = {
  table: "Tabela",
  calendar: "Calendário",
  board: "Quadro",
};

/** Quanto o menu pelo mouse espera um possível segundo clique. */
export const ESPERA_DO_DUPLO = 250;

const MOLA = { type: "spring", duration: DUR[3], bounce: 0.18 } as const;

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
  const avisar = useAvisar();
  const views = [...base.views].sort((a, b) => a.position - b.position);
  const podeEditar = base.can_update_view;
  const podeApagar = base.can_delete_view && !ativa.is_default;
  const temMenu = podeEditar || podeApagar || ativa.is_default;

  const [menu, setMenu] = useState(false);
  const [renomeando, setRenomeando] = useState<string | null>(null);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { anchorRef, panelRef, box } = useAnchoredPanel<HTMLButtonElement>(
    menu,
    () => setMenu(false),
    { larguraPainel: 220 }
  );

  const cancelarEspera = () => {
    if (espera.current) clearTimeout(espera.current);
    espera.current = null;
  };
  useEffect(() => cancelarEspera, []);

  async function renomear(v: BaseView, nome: string) {
    setRenomeando(null);
    const limpo = nome.trim();
    if (!limpo || limpo === v.name) return;
    try {
      const nova = await updateBaseView(base.id, v.id, { name: limpo });
      onViews((vs) => vs.map((x) => (x.id === nova.id ? nova : x)));
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui renomear a visão.");
    }
  }

  async function apagar() {
    setMenu(false);
    try {
      await deleteBaseView(base.id, ativa.id);
      onViews((vs) => vs.filter((x) => x.id !== ativa.id));
      onEscolher(views.find((v) => v.is_default)?.id ?? views[0].id);
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui apagar a visão.");
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-end gap-1">
      <div role="tablist" aria-label="Visões da base" className="flex min-w-0 flex-wrap gap-1">
        {views.map((v) => {
          const selecionada = v.id === ativa.id;
          if (renomeando === v.id) {
            return (
              <CampoDeNome
                key={v.id}
                inicial={v.name}
                onSalvar={(nome) => renomear(v, nome)}
                onCancelar={() => setRenomeando(null)}
              />
            );
          }
          return (
            <button
              key={v.id}
              ref={selecionada ? anchorRef : undefined}
              role="tab"
              aria-selected={selecionada}
              aria-haspopup={selecionada && temMenu ? "dialog" : undefined}
              aria-expanded={selecionada && temMenu ? menu : undefined}
              title={selecionada && temMenu ? "Clique para as opções; duplo clique renomeia" : undefined}
              // Mesmo foco das abas de `Tabs.tsx`: fundo, e não anel.
              className="tappable relative flex items-center gap-1 rounded-t px-3 pb-2 pt-1.5 text-sm outline-none focus-visible:bg-surface-2 focus-visible:outline-none"
              onClick={(e) => {
                if (!selecionada) {
                  onEscolher(v.id);
                  return;
                }
                if (!temMenu) return;
                cancelarEspera();
                if (menu || e.detail === 0) {
                  setMenu((m) => !m);
                  return;
                }
                espera.current = setTimeout(() => setMenu(true), ESPERA_DO_DUPLO);
              }}
              onDoubleClick={() => {
                if (!podeEditar) return;
                cancelarEspera();
                setMenu(false);
                setRenomeando(v.id);
              }}
              onContextMenu={(e) => {
                if (!podeEditar && !base.can_delete_view) return;
                e.preventDefault();
                if (!selecionada) onEscolher(v.id);
                // Espera a aba virar a ativa: é nela que o menu se ancora.
                setTimeout(() => setMenu(true), 0);
              }}
            >
              {selecionada && (
                <motion.span
                  layoutId="visoes-da-base-indicador"
                  className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-accent"
                  transition={MOLA}
                />
              )}
              <span className={selecionada ? "font-semibold text-accent" : "muted"}>{v.name}</span>
              {selecionada && temMenu && (
                <ChevronDown size={12} aria-hidden="true" className="text-accent" />
              )}
            </button>
          );
        })}
      </div>

      {menu && box && (
        <AnchoredPanel
          box={box}
          panelRef={panelRef}
          role="dialog"
          aria-label={`Opções da visão ${ativa.name}`}
          minWidth={220}
        >
          <div className="flex flex-col gap-1 p-1">
            {podeEditar && (
              <button
                className="btn btn-ghost justify-start"
                onClick={() => {
                  setMenu(false);
                  setRenomeando(ativa.id);
                }}
              >
                Renomear
              </button>
            )}
            {podeApagar && (
              <button className="btn btn-ghost justify-start text-danger" onClick={apagar}>
                Apagar visão
              </button>
            )}
            {ativa.is_default && <p className="muted m-0 px-2 text-xs">A visão padrão não se apaga.</p>}
          </div>
        </AnchoredPanel>
      )}

      {base.can_create_view && (
        <NovaVisao
          baseId={base.id}
          colunas={base.columns}
          onCriou={(v) => {
            onViews((vs) => [...vs, v]);
            onEscolher(v.id);
          }}
        />
      )}
    </div>
  );
}

/** Nome da visão editado na aba. Enter ou clicar fora salva; Esc desiste.
 *  O blur dispara depois do Enter: a trava evita gravar duas vezes. */
function CampoDeNome({
  inicial,
  onSalvar,
  onCancelar,
}: {
  inicial: string;
  onSalvar: (nome: string) => void;
  onCancelar: () => void;
}) {
  const [nome, setNome] = useState(inicial);
  const feito = useRef(false);
  const fim = (salvar: boolean) => {
    if (feito.current) return;
    feito.current = true;
    if (salvar) onSalvar(nome);
    else onCancelar();
  };
  return (
    <input
      autoFocus
      className="input mb-1 h-7 w-[160px] text-sm"
      aria-label="Nome da visão"
      value={nome}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setNome(e.target.value)}
      onBlur={() => fim(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          fim(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          fim(false);
        }
      }}
    />
  );
}

function NovaVisao({
  baseId,
  colunas,
  onCriou,
}: {
  baseId: string;
  colunas: BaseColumn[];
  onCriou: (v: BaseView) => void;
}) {
  const avisar = useAvisar();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [layout, setLayout] = useState<BaseView["layout"]>("table");
  // O quadro já nasce agrupado e o calendário com a coluna de data; a primeira que serve vem marcada.
  const doLayout = layout === "board" ? colunasDeAgrupar(colunas) : layout === "calendar" ? colunasDeData(colunas) : [];
  const [coluna, setColuna] = useState<string | null>(null);
  const escolhida = doLayout.find((c) => c.id === coluna)?.id ?? doLayout[0]?.id ?? null;
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
      const config =
        layout === "board" && escolhida
          ? { group_by: escolhida }
          : layout === "calendar" && escolhida
            ? { date_column: escolhida }
            : {};
      onCriou(await createBaseView(baseId, { name: limpo, layout, config }));
      setNome("");
      setLayout("table");
      setColuna(null);
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
        className="btn btn-ghost mb-1"
        style={{ padding: "4px 6px" }}
        aria-label="Nova visão"
        title="Nova visão"
        aria-haspopup="dialog"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
      >
        <Plus size={14} aria-hidden="true" />
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
            {layout !== "table" && (
              <div className="field">
                <label className="label" htmlFor="nova-visao-coluna">
                  {layout === "board" ? "Agrupar por" : "Coluna de data"}
                </label>
                {doLayout.length ? (
                  <select
                    id="nova-visao-coluna"
                    className="input"
                    value={escolhida ?? ""}
                    onChange={(e) => setColuna(e.target.value)}
                  >
                    {doLayout.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="muted m-0 text-xs">
                    {layout === "board"
                      ? "Nenhuma coluna de Seleção ainda. O quadro nasce sem agrupar."
                      : "Nenhuma coluna de Data ainda. O calendário nasce vazio."}
                  </p>
                )}
              </div>
            )}
            <button className="btn btn-primary" disabled={ocupado} onClick={criar}>
              {ocupado ? "Criando…" : "Criar visão"}
            </button>
          </div>
        </AnchoredPanel>
      )}
    </>
  );
}
