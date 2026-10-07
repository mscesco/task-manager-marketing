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
//
// Fatia J, pedidos dela de 07/10 ("igual uma planilha no sheets ou excel"):
// - UM CLIQUE EDITA (antes eram dois). O teclado continua igual: as setas
//   andam, Enter edita.
// - LINHAS DE GRADE entre todas as células, e o fundo é o da página -- sem a
//   caixa branca que sobrava à direita das colunas.
// - A LARGURA SE ARRASTA pela borda direita do cabeçalho (ou pelas setas,
//   com o foco na alça). Ela é da COLUNA, e não da visão: vale para todo mundo
//   e em toda visão, como o resto da coluna. O arraste mostra a largura nova na
//   hora e só grava ao soltar -- um gesto, uma entrada no diário do Ctrl+Z.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent as PointerDoReact,
} from "react";
import { Link2, Plus, Trash2 } from "lucide-react";
import Badge from "@/components/Badge";
import { useAnchoredPanel } from "@/components/AnchoredPanel";
import { useAvisar } from "@/components/Toasts";
import EditorDeEscolha, { type Escolha } from "@/components/bases/EditorDeEscolha";
import EditorDeLinksDaCelula from "@/components/bases/EditorDeLinksDaCelula";
import CabecalhoDaColuna from "@/components/bases/CabecalhoDaColuna";
import { NovaColuna, criarOpcao } from "@/components/bases/MenuDaColuna";
import {
  LARGURA_MAX,
  LARGURA_MIN,
  deslocamentos,
  larguraArrastada,
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
  updateBaseColumn,
  type BaseCellValue,
  type BaseColumn,
  type BaseDetail,
  type BaseRow,
} from "@/lib/api";
import {
  corDaOpcao,
  corDaPessoa,
  editaComTexto,
  interpretarDigitado,
  linksDaCelula,
  mover,
  nomeDoLink,
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
  // A largura sendo arrastada (ou mexida pelas setas) ainda não gravada.
  const [previa, setPrevia] = useState<{ id: string; largura: number } | null>(null);
  const larguras = colunas.map((c, i) => (previa?.id === c.id ? previa.largura : larguraDa(c, i)));
  const esquerdas = deslocamentos(larguras);
  const congeladas = quantasCongeladas(colunas, config);
  const [ativa, setAtiva] = useState<Posicao>({ linha: 0, coluna: 0 });
  const [editando, setEditando] = useState<{ rascunho: string } | null>(null);
  const [escolhendo, setEscolhendo] = useState(false);
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

  // ⚠️ A posição vem EXPLÍCITA no clique: ali o `setAtiva` acabou de ser
  // pedido, e `linhaAtiva`/`colunaAtiva` ainda são os da célula anterior.
  function comecarEdicao(inicial?: string, em: Posicao = ativa) {
    const linha = linhas[em.linha];
    const coluna = colunas[em.coluna];
    if (!base.can_update_row || !linha || !coluna) return;
    if (coluna.type === "checkbox") {
      gravar(linha, coluna, linha.values[coluna.id] !== true);
      return;
    }
    if (editaComTexto(coluna.type)) {
      confirmado.current = false;
      setEditando({ rascunho: inicial ?? textoParaEditar(coluna, linha.values[coluna.id]) });
    } else {
      setEscolhendo(true);
    }
  }

  // Um clique edita (fatia J). ⚠️ Com uma célula já em edição, o clique não
  // faz nada: ele pode ser DENTRO do editor (o evento sobe pela árvore do
  // React, até de um portal), e recomeçar a edição apagaria o que se digitou.
  // Clicar noutra célula já fecha o editor antes, no `mousedown` (o blur do
  // campo, ou o "clique fora" do painel de escolha). Se o texto não passou na
  // validação, o editor fica onde está, e o clique não o arrasta junto.
  function cliqueNaCelula(em: Posicao, tipo: BaseColumn["type"]) {
    if (editando || escolhendo) return;
    setAtiva(em);
    // A caixa de seleção já se marca pelo próprio `onChange`: alternar aqui
    // também a desmarcaria de volta.
    if (tipo !== "checkbox") comecarEdicao(undefined, em);
  }

  async function gravarLargura(coluna: BaseColumn, largura: number) {
    try {
      const nova = await updateBaseColumn(base.id, coluna.id, { width: largura });
      onBase((b) => ({ ...b, columns: b.columns.map((x) => (x.id === nova.id ? nova : x)) }));
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui mudar a largura.");
    } finally {
      setPrevia((p) => (p?.id === coluna.id ? null : p));
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

  // Fatia J: apaga NA HORA, sem o "Apagar / Cancelar" -- ela achou ruim, e
  // ele vazava para fora da tabela. A rede é o Ctrl+Z: a linha apagada fica
  // guardada por 1 dia (D13), e o aviso diz isso.
  async function apagarLinha(linha: BaseRow) {
    onLinhas((ls) => ls.filter((l) => l.id !== linha.id));
    try {
      await deleteBaseRow(base.id, linha.id);
      avisar("Linha apagada. Ctrl+Z (ou Desfazer) traz de volta.");
    } catch (e) {
      onLinhas((ls) => [...ls, linha]);
      avisar((e as ApiError).message || "Não consegui apagar a linha.");
    }
  }

  const titulo = colunas.find((c) => c.type === "title");

  return (
    <div className="flex flex-col gap-2">
      {/* ⚠️ `w-fit`: sem ele a caixa da rolagem ocupa a largura toda, e o
          espaço à direita da última coluna parecia parte da tabela. */}
      <div className="w-fit max-w-full overflow-x-auto">
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
          // ⚠️ `border-separate` com espaçamento zero, e NÃO `border-collapse`:
          // no modo colapsado a borda é da tabela, e a célula presa (sticky)
          // rola sem ela. Por isso cada célula desenha só a direita e a de
          // baixo, e a primeira coluna e o cabeçalho completam o contorno.
          className="table-fixed border-separate border-spacing-0 text-base"
          style={{ width: larguras.reduce((a, b) => a + b, 0) + 2 * LARGURA_DE_ACAO }}
          onKeyDown={teclaNaGrade}
        >
          <thead>
            <tr>
              {colunas.map((c, i) => (
                <th
                  key={c.id}
                  scope="col"
                  className={`border-y border-r border-border bg-canvas px-2 py-1.5 text-left font-normal text-ink-soft ${
                    i < congeladas ? "sticky z-10" : "relative"
                  } ${i === 0 ? "border-l" : ""}`}
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
                  {base.can_update_column && (
                    <AlcaDeLargura
                      coluna={c}
                      largura={larguras[i]}
                      onPrevia={(largura) => setPrevia({ id: c.id, largura })}
                      onSoltar={(largura) => gravarLargura(c, largura)}
                    />
                  )}
                </th>
              ))}
              <th
                scope="col"
                className="px-1 py-1 text-left"
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
                      onClick={() => cliqueNaCelula({ linha: li, coluna: ci }, coluna.type)}
                      style={ci < congeladas ? { left: esquerdas[ci] } : undefined}
                      className={`h-9 overflow-hidden border-b border-r border-border px-2 align-middle ${
                        ci < congeladas ? "sticky z-[1] bg-canvas" : ""
                      } ${ci === 0 ? "border-l font-medium" : ""} ${
                        base.can_update_row ? "cursor-text" : ""
                      } ${ehAtiva ? "outline outline-2 -outline-offset-2 outline-accent" : ""}`}
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
                <td className="px-1 align-middle">
                  {base.can_delete_row && (
                    <button
                      className="btn btn-ghost text-ink-faint opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100"
                      style={{ padding: "2px 4px" }}
                      title="Apagar a linha"
                      aria-label={`Apagar a linha ${
                        titulo ? textoDaCelula(titulo, linha.values[titulo.id]) || li + 1 : li + 1
                      }`}
                      onClick={() => apagarLinha(linha)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
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

// ------------------------------------------------------------------ largura
/** A alça na borda direita do cabeçalho. Arrastar mostra a largura nova na
 *  hora (`onPrevia`) e grava ao soltar (`onSoltar`). Pelo teclado a alça é um
 *  separador focável: as setas mudam 16px e gravam depois de uma pausa, para
 *  segurar a seta não virar uma gravação por tecla. */
function AlcaDeLargura({
  coluna,
  largura,
  onPrevia,
  onSoltar,
}: {
  coluna: BaseColumn;
  largura: number;
  onPrevia: (l: number) => void;
  onSoltar: (l: number) => void;
}) {
  const inicio = useRef<{ x: number; largura: number } | null>(null);
  const atual = useRef(largura);
  const pausa = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pausa.current) clearTimeout(pausa.current);
    },
    []
  );

  function mover(e: PointerDoReact<HTMLDivElement>) {
    if (!inicio.current) return;
    atual.current = larguraArrastada(inicio.current.largura, e.clientX - inicio.current.x);
    onPrevia(atual.current);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Largura da coluna ${coluna.name}`}
      aria-valuenow={largura}
      aria-valuemin={LARGURA_MIN}
      aria-valuemax={LARGURA_MAX}
      tabIndex={0}
      title="Arraste para mudar a largura"
      // Estreita no desenho, larga no alvo (web/AGENTS.md §3): a linha azul
      // aparece no meio dos 9px, em cima da borda da célula.
      className="absolute -right-[5px] top-0 z-20 flex h-full w-[9px] cursor-col-resize touch-none justify-center opacity-0 hover:opacity-100 focus-visible:opacity-100"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        inicio.current = { x: e.clientX, largura };
        atual.current = largura;
      }}
      onPointerMove={mover}
      onPointerUp={(e) => {
        if (!inicio.current) return;
        const mexeu = atual.current !== inicio.current.largura;
        inicio.current = null;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        if (mexeu) onSoltar(atual.current);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        e.stopPropagation();
        atual.current = larguraArrastada(largura, e.key === "ArrowRight" ? 16 : -16);
        onPrevia(atual.current);
        if (pausa.current) clearTimeout(pausa.current);
        pausa.current = setTimeout(() => onSoltar(atual.current), 500);
      }}
    >
      <span className="h-full w-0.5 bg-accent" aria-hidden="true" />
    </div>
  );
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
    case "link": {
      // Fatia J: vários links, em cápsula como os da tarefa (`LinksDoItem`).
      // ⚠️ O clique na cápsula ABRE o link (e não edita a célula): é o gesto
      // de quem quer ver o post. Para editar, clica-se no resto da célula.
      const links = linksDaCelula(valor);
      return (
        <div ref={anchorRef} className="flex min-h-6 flex-wrap items-center gap-1">
          {links.map((l, i) => (
            <a
              key={`${i}-${l.url}`}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              tabIndex={-1}
              title={l.url}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-semibold text-accent no-underline hover:bg-accent-soft"
              onClick={(e) => e.stopPropagation()}
            >
              <Link2 size={12} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{nomeDoLink(l)}</span>
            </a>
          ))}
          {escolhendo && box && (
            <EditorDeLinksDaCelula
              box={box}
              panelRef={panelRef}
              fecharRef={fecharRef}
              titulo={coluna.name}
              links={links}
              onGravar={onGravar}
              onFechar={() => {
                fecharRef.current = null;
                fechar();
              }}
            />
          )}
        </div>
      );
    }
    case "select":
    case "multi_select":
    case "person": {
      const ids = Array.isArray(valor)
        ? (valor as unknown[]).filter((x): x is string => typeof x === "string")
        : typeof valor === "string"
          ? [valor]
          : [];
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
                // Fatia J: cápsula como a da seleção, com a cor da pessoa
                // (`corDaPessoa`); inativo e fora do time ficam cinza.
                <Badge
                  key={id}
                  tone="soft"
                  weight="semibold"
                  color={corDaOpcao(corDaPessoa(id, pessoas.daArvore, pessoas.todos))}
                  className="max-w-full"
                >
                  {rotuloDePessoa(id, pessoas.daArvore, pessoas.todos)}
                </Badge>
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
