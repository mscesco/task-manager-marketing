"use client";
// components/bases/TabelaDaBase.tsx
// A tabela editável da Base (Spec 056, fatia E, §12).
//
// ⚠️⚠️ É UMA GRADE DE VERDADE PARA O TECLADO (web/AGENTS.md §2): `<table
// role="grid">`, UMA célula com `tabIndex=0` por vez (o "roving tabindex"), e
// o foco anda com as setas. Enter edita, Esc cancela, Tab vai para a próxima.
// Digitar uma letra numa célula de texto já começa a editar com ela, como numa
// planilha. A regra de para onde o foco vai é pura e testada: `mover()` em
// `lib/baseTable.ts`.
//
// ⚠️ GRAVA SÓ A CÉLULA, otimista: a tela muda na hora, e volta se o servidor
// recusar (com o motivo num aviso). A linha que o servidor devolve substitui a
// local -- é ela que tem a `version` nova.
//
// ⚠️ A PRIMEIRA COLUNA (título) FICA PRESA na rolagem horizontal (`sticky`).
// Com 9 colunas o título some da tela, e é por ele que se sabe de que linha
// se está falando.

import { useEffect, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import { Plus, Trash2 } from "lucide-react";
import Badge from "@/components/Badge";
import { useAnchoredPanel } from "@/components/AnchoredPanel";
import { useAvisar } from "@/components/Toasts";
import EditorDeEscolha, { type Escolha } from "@/components/bases/EditorDeEscolha";
import CabecalhoDaColuna from "@/components/bases/CabecalhoDaColuna";
import { NovaColuna, criarOpcao } from "@/components/bases/MenuDaColuna";
import {
  deslocamentos,
  larguraDa,
  lerConfig,
  quantasCongeladas,
  type ConfigDaVisao,
} from "@/lib/baseViews";

/** A largura das duas colunas de ação (o "+" e o apagar linha). */
const LARGURA_DE_ACAO = 44;
import { useGravarCelula } from "@/components/bases/useGravarCelula";
import {
  ApiError,
  createBaseRow,
  deleteBaseRow,
  type BaseCellValue,
  type BaseColumn,
  type BaseDetail,
  type BaseRow,
} from "@/lib/api";
import {
  corDaOpcao,
  editaComTexto,
  interpretarDigitado,
  mover,
  rotuloDePessoa,
  textoDaCelula,
  textoParaEditar,
  type PessoaConhecida,
  type Posicao,
} from "@/lib/baseTable";

export type Pessoas = {
  todos: ReadonlyMap<string, PessoaConhecida>;
  daArvore: ReadonlySet<string>;
};

export default function TabelaDaBase({
  base,
  colunas: visiveis,
  linhas,
  pessoas,
  noTeto,
  onBase,
  onLinhas,
  onLinhaCriada,
  ocupadoRef,
  config: configDaVisao,
  onConfig,
  onRecarregar,
}: {
  /** Fatia I: a config da visão -- o menu do cabeçalho filtra, ordena,
   *  congela e oculta por ela. Sem `onConfig`, esses itens não aparecem. */
  config?: ConfigDaVisao;
  onConfig?: (c: ConfigDaVisao) => void;
  /** Inserir e duplicar mexem na posição das OUTRAS colunas: recarrega. */
  onRecarregar?: () => void;
  base: BaseDetail;
  /** As colunas da VISÃO (fatia F: as escondidas saem). Padrão: todas. */
  colunas?: BaseColumn[];
  /** As linhas da visão -- já filtradas e ordenadas. */
  linhas: BaseRow[];
  /** A linha nova passa pelo filtro da visão até recarregar (ver `aplicarVisao`). */
  onLinhaCriada?: (id: string) => void;
  pessoas: Pessoas;
  /** No teto de linhas (D23): "+ Nova linha" some. */
  noTeto: boolean;
  onBase: (atualizar: (b: BaseDetail) => BaseDetail) => void;
  onLinhas: (atualizar: (l: BaseRow[]) => BaseRow[]) => void;
  /** A página não recarrega enquanto isto for `true` (alguém editando). */
  ocupadoRef: MutableRefObject<boolean>;
}) {
  const avisar = useAvisar();
  const colunas = visiveis ?? base.columns;
  const config = configDaVisao ?? lerConfig({});
  const larguras = colunas.map((c, i) => larguraDa(c, i));
  const esquerdas = deslocamentos(larguras);
  const congeladas = quantasCongeladas(colunas, config);
  const [ativa, setAtiva] = useState<Posicao>({ linha: 0, coluna: 0 });
  const [editando, setEditando] = useState<{ rascunho: string } | null>(null);
  const [escolhendo, setEscolhendo] = useState(false);
  const [apagando, setApagando] = useState<string | null>(null);
  const celulas = useRef(new Map<string, HTMLTableCellElement>());

  ocupadoRef.current = editando !== null || escolhendo;

  // O foco acompanha a célula ativa -- mas só se ele já está na tabela (ou
  // acabou de sair de um editor dela), para não roubar o foco de quem está no
  // cabeçalho ou noutro lugar da página.
  const tabelaRef = useRef<HTMLTableElement>(null);
  const voltarFoco = useRef(false);
  useEffect(() => {
    if (editando || escolhendo) return;
    if (!voltarFoco.current && !tabelaRef.current?.contains(document.activeElement)) return;
    voltarFoco.current = false;
    celulas.current.get(chave(ativa))?.focus();
  }, [ativa, editando, escolhendo]);

  // ⚠️ O `onBlur` do editor também confirma (clicar fora salva), e ele dispara
  // DEPOIS do Enter, quando o campo some. Sem esta trava a mesma célula iria
  // duas vezes ao servidor -- duas entradas no diário para um gesto.
  const confirmado = useRef(false);

  const linhaAtiva = linhas[ativa.linha];
  const colunaAtiva = colunas[ativa.coluna];

  const gravar = useGravarCelula(base.id, onLinhas);

  function comecarEdicao(inicial?: string) {
    if (!base.can_update_row || !linhaAtiva || !colunaAtiva) return;
    if (colunaAtiva.type === "checkbox") {
      gravar(linhaAtiva, colunaAtiva, linhaAtiva.values[colunaAtiva.id] !== true);
      return;
    }
    if (editaComTexto(colunaAtiva.type)) {
      confirmado.current = false;
      setEditando({
        rascunho: inicial ?? textoParaEditar(colunaAtiva, linhaAtiva.values[colunaAtiva.id]),
      });
    } else {
      setEscolhendo(true);
    }
  }

  function confirmarTexto(depois?: "Enter" | "Tab" | "ShiftTab") {
    if (!editando || !linhaAtiva || !colunaAtiva || confirmado.current) return;
    const r = interpretarDigitado(colunaAtiva, editando.rascunho);
    if (!r.ok) {
      avisar(r.erro);
      return;
    }
    confirmado.current = true;
    gravar(linhaAtiva, colunaAtiva, r.valor);
    setEditando(null);
    // Clicar fora (sem `depois`) leva o foco para onde se clicou; Enter e Tab
    // o devolvem à grade, na célula seguinte.
    if (depois) {
      voltarFoco.current = true;
      setAtiva((p) => mover(p, depois, linhas.length, colunas.length));
    }
  }

  function cancelarTexto() {
    confirmado.current = true;
    voltarFoco.current = true;
    setEditando(null);
  }

  function teclaNaGrade(e: KeyboardEvent<HTMLTableElement>) {
    if (editando || escolhendo) return;
    if (!(e.target as HTMLElement).dataset?.celula) return;
    const setas = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;
    if ((setas as readonly string[]).includes(e.key)) {
      e.preventDefault();
      setAtiva((p) => mover(p, e.key as (typeof setas)[number], linhas.length, colunas.length));
    } else if (e.key === "Tab") {
      const destino = mover(ativa, e.shiftKey ? "ShiftTab" : "Tab", linhas.length, colunas.length);
      // Na última célula o Tab sai da tabela, como qualquer outro campo.
      if (destino.linha === ativa.linha && destino.coluna === ativa.coluna) return;
      e.preventDefault();
      setAtiva(destino);
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      comecarEdicao();
    } else if (e.key === " " && colunaAtiva?.type === "checkbox") {
      e.preventDefault();
      comecarEdicao();
    } else if ((e.key === "Delete" || e.key === "Backspace") && base.can_update_row) {
      e.preventDefault();
      if (linhaAtiva && colunaAtiva) gravar(linhaAtiva, colunaAtiva, null);
    } else if (
      e.key.length === 1 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      colunaAtiva &&
      editaComTexto(colunaAtiva.type) &&
      colunaAtiva.type !== "date"
    ) {
      e.preventDefault();
      comecarEdicao(e.key);
    }
  }

  async function novaLinha() {
    try {
      const nova = await createBaseRow(base.id);
      onLinhaCriada?.(nova.id);
      onLinhas((ls) => [...ls, nova]);
      setAtiva({ linha: linhas.length, coluna: 0 });
      confirmado.current = false;
      setEditando({ rascunho: "" });
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui criar a linha.");
    }
  }

  async function apagarLinha(linha: BaseRow) {
    setApagando(null);
    onLinhas((ls) => ls.filter((l) => l.id !== linha.id));
    try {
      await deleteBaseRow(base.id, linha.id);
    } catch (e) {
      onLinhas((ls) => [...ls, linha]);
      avisar((e as ApiError).message || "Não consegui apagar a linha.");
    }
  }

  const titulo = colunas.find((c) => c.type === "title");

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        {/* ⚠️ LARGURA FIXA POR COLUNA (`table-fixed`), fatia I: com várias
            colunas congeladas, cada uma precisa saber onde a anterior acaba
            (`deslocamentos`). Com largura pelo conteúdo, a segunda presa
            pousaria por cima da primeira. A largura total é de runtime -- a
            exceção do estilo inline (web/AGENTS.md §11). */}
        <table
          ref={tabelaRef}
          role="grid"
          aria-label={base.name}
          aria-rowcount={linhas.length + 1}
          className="table-fixed border-collapse text-base"
          style={{ width: larguras.reduce((a, b) => a + b, 0) + 2 * LARGURA_DE_ACAO }}
          onKeyDown={teclaNaGrade}
        >
          <thead>
            <tr>
              {colunas.map((c, i) => (
                <th
                  key={c.id}
                  scope="col"
                  className={`border-b border-border bg-surface-2 px-2 py-1.5 text-left ${
                    i < congeladas ? "sticky z-10" : ""
                  } ${i === congeladas - 1 ? "border-r" : ""}`}
                  style={{ width: larguras[i], left: i < congeladas ? esquerdas[i] : undefined }}
                >
                  <div className="flex min-w-0 items-center gap-1">
                    <CabecalhoDaColuna
                      baseId={base.id}
                      coluna={c}
                      podeEditar={base.can_update_column}
                      podeCriar={base.can_create_column}
                      podeApagar={base.can_delete_column}
                      podeEditarVisao={!!onConfig && base.can_update_view}
                      config={config}
                      onConfig={(c2) => onConfig?.(c2)}
                      onCriou={() => onRecarregar?.()}
                      onMudou={(nova, zerou) => {
                        onBase((b) => ({
                          ...b,
                          columns: b.columns.map((x) => (x.id === nova.id ? nova : x)),
                        }));
                        if (zerou) {
                          onLinhas((ls) =>
                            ls.map((l) => {
                              if (!(nova.id in l.values)) return l;
                              const values = { ...l.values };
                              delete values[nova.id];
                              return { ...l, values };
                            })
                          );
                        }
                      }}
                      onApagou={(id) => {
                        onBase((b) => ({ ...b, columns: b.columns.filter((x) => x.id !== id) }));
                        setAtiva((p) => ({ ...p, coluna: Math.max(0, Math.min(p.coluna, colunas.length - 2)) }));
                      }}
                    />
                  </div>
                </th>
              ))}
              <th
                scope="col"
                className="border-b border-border bg-surface-2 px-1 py-1 text-left"
                style={{ width: LARGURA_DE_ACAO }}
              >
                {base.can_create_column && (
                  <NovaColuna
                    baseId={base.id}
                    onCriou={(c) => onBase((b) => ({ ...b, columns: [...b.columns, c] }))}
                  />
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha, li) => (
              <tr key={linha.id} className="group">
                {colunas.map((coluna, ci) => {
                  const ehAtiva = ativa.linha === li && ativa.coluna === ci;
                  return (
                    <td
                      key={coluna.id}
                      ref={(el) => {
                        if (el) celulas.current.set(`${li}:${ci}`, el);
                        else celulas.current.delete(`${li}:${ci}`);
                      }}
                      role="gridcell"
                      data-celula="1"
                      tabIndex={ehAtiva ? 0 : -1}
                      aria-label={`${coluna.name}, linha ${li + 1}`}
                      aria-readonly={!base.can_update_row}
                      onClick={() => setAtiva({ linha: li, coluna: ci })}
                      onDoubleClick={() => {
                        setAtiva({ linha: li, coluna: ci });
                        if (coluna.type !== "checkbox") requestAnimationFrame(() => comecarEdicao());
                      }}
                      style={ci < congeladas ? { left: esquerdas[ci] } : undefined}
                      className={`h-9 overflow-hidden border-b border-border px-2 align-middle ${
                        ci < congeladas ? "sticky z-[1] bg-surface" : ""
                      } ${ci === 0 ? "font-medium" : ""} ${ci === congeladas - 1 ? "border-r" : ""} ${
                        ehAtiva ? "outline outline-2 -outline-offset-2 outline-accent" : ""
                      }`}
                    >
                      {ehAtiva && editando ? (
                        <EditorDeTexto
                          coluna={coluna}
                          rascunho={editando.rascunho}
                          onMudar={(rascunho) => setEditando({ rascunho })}
                          onConfirmar={confirmarTexto}
                          onCancelar={cancelarTexto}
                        />
                      ) : (
                        <Celula
                          baseId={base.id}
                          coluna={coluna}
                          linha={linha}
                          pessoas={pessoas}
                          podeEditar={base.can_update_row}
                          podeCriarOpcao={base.can_update_column}
                          escolhendo={ehAtiva && escolhendo}
                          onEscolhendo={setEscolhendo}
                          onGravar={(v) => gravar(linha, coluna, v)}
                          onColuna={(nova) =>
                            onBase((b) => ({
                              ...b,
                              columns: b.columns.map((x) => (x.id === nova.id ? nova : x)),
                            }))
                          }
                          onFoco={() => celulas.current.get(`${li}:${ci}`)?.focus()}
                        />
                      )}
                    </td>
                  );
                })}
                <td className="border-b border-border px-1 align-middle">
                  {base.can_delete_row &&
                    (apagando === linha.id ? (
                      <span className="flex items-center gap-1">
                        <button className="btn btn-danger text-xs" onClick={() => apagarLinha(linha)}>
                          Apagar
                        </button>
                        <button className="btn btn-ghost text-xs" onClick={() => setApagando(null)}>
                          Cancelar
                        </button>
                      </span>
                    ) : (
                      <button
                        className="btn btn-ghost opacity-0 group-hover:opacity-100 focus:opacity-100"
                        style={{ padding: "2px 4px" }}
                        aria-label={`Apagar a linha ${
                          titulo ? textoDaCelula(titulo, linha.values[titulo.id]) || li + 1 : li + 1
                        }`}
                        onClick={() => setApagando(linha.id)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {linhas.length === 0 && (
          <p className="muted m-0 px-3 py-4 text-sm">Nenhuma linha ainda.</p>
        )}
      </div>
      {base.can_create_row && !noTeto && (
        <div>
          <button className="btn btn-ghost text-sm" onClick={novaLinha}>
            <Plus size={14} aria-hidden="true" /> Nova linha
          </button>
        </div>
      )}
    </div>
  );
}

function chave(p: Posicao): string {
  return `${p.linha}:${p.coluna}`;
}

// ------------------------------------------------------------------ editor
function EditorDeTexto({
  coluna,
  rascunho,
  onMudar,
  onConfirmar,
  onCancelar,
}: {
  coluna: BaseColumn;
  rascunho: string;
  onMudar: (s: string) => void;
  onConfirmar: (depois?: "Enter" | "Tab" | "ShiftTab") => void;
  onCancelar: () => void;
}) {
  const tipo = coluna.type === "date" ? "date" : coluna.type === "link" ? "url" : "text";
  return (
    <input
      autoFocus
      className="input h-7 w-full"
      type={tipo}
      inputMode={coluna.type === "number" ? "decimal" : undefined}
      aria-label={`Editar ${coluna.name}`}
      value={rascunho}
      onChange={(e) => onMudar(e.target.value)}
      onBlur={() => onConfirmar()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          onConfirmar("Enter");
        } else if (e.key === "Tab") {
          e.preventDefault();
          onConfirmar(e.shiftKey ? "ShiftTab" : "Tab");
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancelar();
        }
      }}
    />
  );
}

// ------------------------------------------------------------------ célula
function Celula({
  baseId,
  coluna,
  linha,
  pessoas,
  podeEditar,
  podeCriarOpcao,
  escolhendo,
  onEscolhendo,
  onGravar,
  onColuna,
  onFoco,
}: {
  baseId: string;
  coluna: BaseColumn;
  linha: BaseRow;
  pessoas: Pessoas;
  podeEditar: boolean;
  podeCriarOpcao: boolean;
  escolhendo: boolean;
  onEscolhendo: (v: boolean) => void;
  onGravar: (v: BaseCellValue | null) => void;
  onColuna: (c: BaseColumn) => void;
  onFoco: () => void;
}) {
  const valor = linha.values[coluna.id];
  const avisar = useAvisar();
  const fecharRef = useRef<(() => void) | null>(null);
  const fechar = () => {
    onEscolhendo(false);
    requestAnimationFrame(onFoco);
  };
  const { anchorRef, panelRef, box } = useAnchoredPanel<HTMLDivElement>(
    escolhendo,
    () => (fecharRef.current ? fecharRef.current() : fechar())
  );

  switch (coluna.type) {
    case "checkbox":
      return (
        <input
          type="checkbox"
          tabIndex={-1}
          aria-label={coluna.name}
          checked={valor === true}
          disabled={!podeEditar}
          onChange={(e) => onGravar(e.target.checked)}
        />
      );
    case "link":
      return typeof valor === "string" ? (
        <a
          href={valor}
          target="_blank"
          rel="noreferrer noopener"
          tabIndex={-1}
          className="block max-w-[320px] truncate text-accent"
          onClick={(e) => e.stopPropagation()}
        >
          {valor}
        </a>
      ) : null;
    case "select":
    case "multi_select":
    case "person": {
      const ids = Array.isArray(valor) ? valor : typeof valor === "string" ? [valor] : [];
      const opcoes: Escolha[] =
        coluna.type === "person"
          ? [...pessoas.daArvore]
              .filter((id) => pessoas.todos.get(id)?.is_active)
              .map((id) => ({ id, rotulo: pessoas.todos.get(id)!.name }))
              .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"))
          : coluna.options.map((o) => ({ id: o.id, rotulo: o.label, cor: corDaOpcao(o.color) }));
      return (
        <div ref={anchorRef} className="flex min-h-6 flex-wrap items-center gap-1">
          {coluna.type === "person"
            ? ids.map((id) => (
                <span key={id} className="truncate text-sm">
                  {rotuloDePessoa(id, pessoas.daArvore, pessoas.todos)}
                </span>
              ))
            : ids.map((id) => {
                // Opção apagada: a célula guarda o id, e aparece vazia (D17).
                const o = coluna.options.find((x) => x.id === id);
                return o ? (
                  <Badge key={id} tone="soft" color={corDaOpcao(o.color)}>
                    {o.label}
                  </Badge>
                ) : null;
              })}
          {escolhendo && box && (
            <EditorDeEscolha
              box={box}
              panelRef={panelRef}
              fecharRef={fecharRef}
              titulo={coluna.name}
              opcoes={opcoes}
              selecionados={ids}
              multiplo={coluna.type !== "select"}
              podeCriar={coluna.type !== "person" && podeCriarOpcao}
              onCriar={async (rotulo) => {
                try {
                  const nova = await criarOpcao(baseId, coluna, rotulo);
                  onColuna(nova);
                  return nova.options.find((o) => o.label === rotulo)?.id ?? null;
                } catch (e) {
                  avisar((e as ApiError).message || "Não consegui criar a opção.");
                  return null;
                }
              }}
              onGravar={(novos) =>
                onGravar(
                  coluna.type === "select" ? (novos[0] ?? null) : novos.length ? novos : null
                )
              }
              onFechar={() => {
                fecharRef.current = null;
                fechar();
              }}
            />
          )}
        </div>
      );
    }
    default:
      return <span className="block max-w-[420px] truncate">{textoDaCelula(coluna, valor)}</span>;
  }
}
