"use client";
// components/bases/ControlesDaVisao.tsx
// Filtro, ordenação, colunas visíveis, agrupar (quadro) e data (calendário)
// de uma visão da Base (Spec 056, fatia F, §8).
//
// ⚠️ MEXER AQUI MUDA A VISÃO DE TODO MUNDO (D14), e por isso só com
// `can_update_view`. Sem ele os botões continuam aparecendo -- para a pessoa
// VER qual filtro está valendo --, mas o conteúdo fica só de leitura.
//
// O que filtrar e ordenar SIGNIFICA é de `lib/baseViews.ts` (puro, testado);
// aqui só se monta a configuração.

import { useState, type ReactNode } from "react";
import { ArrowUpDown, CalendarDays, Columns3, Filter, Group, Plus, Trash2 } from "lucide-react";
import AnchoredPanel, { useAnchoredPanel } from "@/components/AnchoredPanel";
import type { BaseColumn, BaseView } from "@/lib/api";
import { NOME_DO_TIPO } from "@/lib/baseTable";
import {
  colunasDeAgrupar,
  colunasDeData,
  operadoresDo,
  type ConfigDaVisao,
  type Filtro,
  type OperadorDeFiltro,
} from "@/lib/baseViews";
import type { Escolha } from "@/components/bases/EditorDeEscolha";

export default function ControlesDaVisao({
  layout,
  colunas,
  config,
  podeEditar,
  escolhasDe,
  onConfig,
}: {
  layout: BaseView["layout"];
  colunas: BaseColumn[];
  config: ConfigDaVisao;
  podeEditar: boolean;
  /** As escolhas de uma coluna de seleção ou pessoa (para o filtro). */
  escolhasDe: (c: BaseColumn) => Escolha[];
  onConfig: (c: ConfigDaVisao) => void;
}) {
  const porId = new Map(colunas.map((c) => [c.id, c]));
  const filtros = config.filters.filter((f) => porId.has(f.column_id));
  const ordens = config.sorts.filter((o) => porId.has(o.column_id));
  const escondidas = config.hidden_columns.filter((id) => porId.has(id));

  return (
    <div className="flex flex-wrap items-center gap-0.5">
      <Painel
        rotulo={`Filtro${filtros.length ? ` (${filtros.length})` : ""}`}
        icone={<Filter size={14} aria-hidden="true" />}
        titulo="Filtros da visão"
      >
        <Filtros
          colunas={colunas}
          filtros={filtros}
          podeEditar={podeEditar}
          escolhasDe={escolhasDe}
          onMudar={(filters) => onConfig({ ...config, filters })}
        />
      </Painel>
      <Painel
        rotulo={`Ordenar${ordens.length ? ` (${ordens.length})` : ""}`}
        icone={<ArrowUpDown size={14} aria-hidden="true" />}
        titulo="Ordenação da visão"
      >
        <Ordens
          colunas={colunas}
          config={config}
          podeEditar={podeEditar}
          onConfig={onConfig}
        />
      </Painel>
      {layout === "table" && (
        <Painel
          rotulo={`Colunas${escondidas.length ? ` (${escondidas.length} ocultas)` : ""}`}
          icone={<Columns3 size={14} aria-hidden="true" />}
          titulo="Colunas visíveis"
        >
          <ul className="m-0 flex list-none flex-col gap-1 p-1">
            {colunas
              .filter((c) => c.type !== "title")
              .map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={!podeEditar}
                      checked={!config.hidden_columns.includes(c.id)}
                      onChange={(e) =>
                        onConfig({
                          ...config,
                          hidden_columns: e.target.checked
                            ? config.hidden_columns.filter((id) => id !== c.id)
                            : [...config.hidden_columns, c.id],
                        })
                      }
                    />
                    <span className="min-w-0 truncate">{c.name}</span>
                  </label>
                </li>
              ))}
          </ul>
        </Painel>
      )}
      {layout === "board" && (
        <EscolhaDeColuna
          rotulo="Agrupar por"
          icone={<Group size={14} aria-hidden="true" className="text-ink-soft" />}
          colunas={colunasDeAgrupar(colunas)}
          valor={config.group_by}
          vazio="Crie uma coluna de Seleção para montar o quadro."
          podeEditar={podeEditar}
          onEscolher={(group_by) => onConfig({ ...config, group_by })}
        />
      )}
      {layout === "calendar" && (
        <EscolhaDeColuna
          rotulo="Data"
          icone={<CalendarDays size={14} aria-hidden="true" className="text-ink-soft" />}
          colunas={colunasDeData(colunas)}
          valor={config.date_column}
          vazio="Crie uma coluna de Data para montar o calendário."
          podeEditar={podeEditar}
          onEscolher={(date_column) => onConfig({ ...config, date_column })}
        />
      )}
    </div>
  );
}

function Painel({
  rotulo,
  icone,
  titulo,
  children,
}: {
  rotulo: string;
  icone: ReactNode;
  titulo: string;
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const { anchorRef, panelRef, box } = useAnchoredPanel<HTMLButtonElement>(
    aberto,
    () => setAberto(false),
    // Fatia J: os controles moram no canto DIREITO da barra; o painel abre
    // para a esquerda, para dentro da tela.
    { larguraPainel: 420, alinhar: "direita" }
  );
  // Fatia J: só o ícone (*"achei que ficou muita coisa escrita"*). O rótulo
  // inteiro -- com a contagem -- fica no `aria-label` e na dica; à vista, só
  // o número, e o ícone azul quando há algo valendo.
  const contagem = rotulo.match(/\((\d+)/)?.[1];
  return (
    <>
      <button
        ref={anchorRef}
        className={`btn btn-ghost text-sm ${contagem ? "text-accent" : ""}`}
        style={{ padding: "4px 6px" }}
        aria-label={rotulo}
        title={rotulo}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
      >
        {icone}
        {contagem && (
          <span className="text-xs" aria-hidden="true">
            {contagem}
          </span>
        )}
      </button>
      {aberto && box && (
        <AnchoredPanel box={box} panelRef={panelRef} role="dialog" aria-label={titulo} minWidth={420}>
          {children}
        </AnchoredPanel>
      )}
    </>
  );
}

function Filtros({
  colunas,
  filtros,
  podeEditar,
  escolhasDe,
  onMudar,
}: {
  colunas: BaseColumn[];
  filtros: Filtro[];
  podeEditar: boolean;
  escolhasDe: (c: BaseColumn) => Escolha[];
  onMudar: (f: Filtro[]) => void;
}) {
  const trocar = (i: number, f: Filtro) => onMudar(filtros.map((x, j) => (j === i ? f : x)));
  return (
    <div className="flex flex-col gap-2 p-1">
      {filtros.length === 0 && <p className="muted m-0 text-sm">Nenhum filtro: a visão mostra todas as linhas.</p>}
      {filtros.map((f, i) => {
        const coluna = colunas.find((c) => c.id === f.column_id)!;
        const ops = operadoresDo(coluna.type);
        const op = ops.find((o) => o.id === f.operator) ?? ops[0];
        return (
          <div key={i} className="flex flex-col gap-1 rounded-md border border-border p-2">
            <div className="flex items-center gap-1">
              <select
                className="input min-w-0 flex-1"
                aria-label="Coluna do filtro"
                disabled={!podeEditar}
                value={coluna.id}
                onChange={(e) => {
                  const nova = colunas.find((c) => c.id === e.target.value)!;
                  trocar(i, { column_id: nova.id, operator: operadoresDo(nova.type)[0].id });
                }}
              >
                {colunas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                className="input min-w-0 flex-1"
                aria-label="Condição do filtro"
                disabled={!podeEditar}
                value={op.id}
                onChange={(e) =>
                  trocar(i, { column_id: coluna.id, operator: e.target.value as OperadorDeFiltro })
                }
              >
                {ops.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              {podeEditar && (
                <button
                  className="btn btn-ghost"
                  style={{ padding: "4px 6px" }}
                  aria-label={`Tirar o filtro de ${coluna.name}`}
                  onClick={() => onMudar(filtros.filter((_, j) => j !== i))}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              )}
            </div>
            {op.precisaValor && (
              <ValorDoFiltro
                coluna={coluna}
                filtro={f}
                podeEditar={podeEditar}
                escolhas={escolhasDe(coluna)}
                onMudar={(value) => trocar(i, { ...f, operator: op.id, value })}
              />
            )}
          </div>
        );
      })}
      {podeEditar && colunas.length > 0 && (
        <button
          className="btn btn-ghost self-start text-sm"
          onClick={() =>
            onMudar([
              ...filtros,
              { column_id: colunas[0].id, operator: operadoresDo(colunas[0].type)[0].id },
            ])
          }
        >
          <Plus size={14} aria-hidden="true" /> Adicionar filtro
        </button>
      )}
    </div>
  );
}

function ValorDoFiltro({
  coluna,
  filtro,
  podeEditar,
  escolhas,
  onMudar,
}: {
  coluna: BaseColumn;
  filtro: Filtro;
  podeEditar: boolean;
  escolhas: Escolha[];
  onMudar: (v: Filtro["value"]) => void;
}) {
  if (coluna.type === "select" || coluna.type === "multi_select" || coluna.type === "person") {
    const marcados = Array.isArray(filtro.value) ? filtro.value : [];
    return (
      <ul className="m-0 flex max-h-40 list-none flex-col gap-1 overflow-y-auto p-0">
        {escolhas.map((e) => (
          <li key={e.id}>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={!podeEditar}
                checked={marcados.includes(e.id)}
                onChange={(ev) =>
                  onMudar(ev.target.checked ? [...marcados, e.id] : marcados.filter((x) => x !== e.id))
                }
              />
              <span className="min-w-0 truncate">{e.rotulo}</span>
            </label>
          </li>
        ))}
        {escolhas.length === 0 && <li className="muted text-xs">Nenhuma opção nesta coluna.</li>}
      </ul>
    );
  }
  return (
    <input
      className="input"
      aria-label={`Valor do filtro de ${coluna.name}`}
      disabled={!podeEditar}
      type={coluna.type === "date" ? "date" : "text"}
      inputMode={coluna.type === "number" ? "decimal" : undefined}
      value={typeof filtro.value === "string" || typeof filtro.value === "number" ? String(filtro.value) : ""}
      // ⚠️ Texto como veio (só a vírgula vira ponto): converter para número a
      // cada tecla apagaria o "1," no meio de "1,5". Quem compara é `passa`,
      // com `Number()`.
      onChange={(e) =>
        onMudar(coluna.type === "number" ? e.target.value.replace(",", ".") : e.target.value)
      }
    />
  );
}

function Ordens({
  colunas,
  config,
  podeEditar,
  onConfig,
}: {
  colunas: BaseColumn[];
  config: ConfigDaVisao;
  podeEditar: boolean;
  onConfig: (c: ConfigDaVisao) => void;
}) {
  const ordens = config.sorts.filter((o) => colunas.some((c) => c.id === o.column_id));
  const mudar = (sorts: ConfigDaVisao["sorts"]) => onConfig({ ...config, sorts });
  return (
    <div className="flex flex-col gap-2 p-1">
      {ordens.length === 0 && <p className="muted m-0 text-sm">Na ordem em que as linhas foram criadas.</p>}
      {ordens.map((o, i) => (
        <div key={i} className="flex items-center gap-1">
          <select
            className="input min-w-0 flex-1"
            aria-label="Coluna da ordenação"
            disabled={!podeEditar}
            value={o.column_id}
            onChange={(e) => mudar(ordens.map((x, j) => (j === i ? { ...x, column_id: e.target.value } : x)))}
          >
            {colunas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({NOME_DO_TIPO[c.type]})
              </option>
            ))}
          </select>
          <select
            className="input w-[140px]"
            aria-label="Direção da ordenação"
            disabled={!podeEditar}
            value={o.direction}
            onChange={(e) =>
              mudar(ordens.map((x, j) => (j === i ? { ...x, direction: e.target.value as "asc" | "desc" } : x)))
            }
          >
            <option value="asc">Crescente</option>
            <option value="desc">Decrescente</option>
          </select>
          {podeEditar && (
            <button
              className="btn btn-ghost"
              style={{ padding: "4px 6px" }}
              aria-label="Tirar esta ordenação"
              onClick={() => mudar(ordens.filter((_, j) => j !== i))}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
      {podeEditar && colunas.length > 0 && (
        <button
          className="btn btn-ghost self-start text-sm"
          onClick={() => mudar([...ordens, { column_id: colunas[0].id, direction: "asc" }])}
        >
          <Plus size={14} aria-hidden="true" /> Adicionar ordenação
        </button>
      )}
    </div>
  );
}

/** "Agrupar por" (quadro) e "Data" (calendário). Fatia J: era um `<select>`
 *  nativo, que destoava dos outros controles da barra (ela achou ruim). Virou
 *  um botão com o ícone e o nome da coluna escolhida, que abre a lista. */
function EscolhaDeColuna({
  rotulo,
  icone,
  colunas,
  valor,
  vazio,
  podeEditar,
  onEscolher,
}: {
  rotulo: string;
  icone: ReactNode;
  colunas: BaseColumn[];
  valor: string | null;
  vazio: string;
  podeEditar: boolean;
  onEscolher: (id: string | null) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const { anchorRef, panelRef, box } = useAnchoredPanel<HTMLButtonElement>(
    aberto,
    () => setAberto(false),
    { larguraPainel: 240, alinhar: "direita" }
  );
  if (!colunas.length) return <span className="muted text-sm">{vazio}</span>;
  const escolhida = colunas.find((c) => c.id === valor);
  return (
    <>
      <button
        ref={anchorRef}
        className="btn btn-ghost text-sm"
        style={{ padding: "4px 8px" }}
        aria-label={`${rotulo}: ${escolhida?.name ?? "nenhuma"}`}
        title={rotulo}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
      >
        {icone}
        <span className={escolhida ? "" : "muted"}>{escolhida?.name ?? "Escolha…"}</span>
      </button>
      {aberto && box && (
        <AnchoredPanel box={box} panelRef={panelRef} role="dialog" aria-label={rotulo} minWidth={240}>
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-1">
            <legend className="label mb-1">{rotulo}</legend>
            {colunas.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-surface-2">
                <input
                  type="radio"
                  name={`escolha-${rotulo}`}
                  disabled={!podeEditar}
                  checked={c.id === valor}
                  onChange={() => {
                    onEscolher(c.id);
                    setAberto(false);
                  }}
                />
                <span className="min-w-0 truncate">{c.name}</span>
              </label>
            ))}
          </fieldset>
        </AnchoredPanel>
      )}
    </>
  );
}
