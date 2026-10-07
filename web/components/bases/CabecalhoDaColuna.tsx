"use client";
// components/bases/CabecalhoDaColuna.tsx
// O cabeçalho de uma coluna da Base, como o do Notion (Spec 056, fatia I,
// pedido dela em 07/10 com o print do menu "Data"):
//
//   *"Tudo é clicável, nada de ter que clicar em 3 pontos pra editar"*
//
// O CABEÇALHO INTEIRO É O BOTÃO. Ele abre o menu da coluna: o nome editável no
// topo, e embaixo Editar propriedade ›, Alterar tipo ›, Filtrar, Ordenar ›,
// Congelar, Ocultar, Inserir à esquerda/direita, Duplicar e Excluir. As setas
// "›" abrem SUBMENU AO LADO (escolha dela), no `AnchoredPanel` com `aoLado`.
//
// ⚠️ CADA ITEM PERGUNTA O SEU CADEADO, vindo do servidor:
//   coluna (nome, tipo, opções)      -> can_update_column
//   inserir, duplicar                -> can_create_column
//   excluir coluna, apagar opção     -> can_delete_column
//   filtrar, ordenar, congelar, ocultar -> can_update_view (a visão é de todos)
// Quem não pode nada vê só o nome, sem botão.
//
// ⚠️ "Calcular", "Agrupar" na tabela, "Quebrar texto" e "Acesso à propriedade"
// ficaram de fora desta fatia, por decisão dela (07/10).

import { useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownUp,
  ArrowLeftToLine,
  ArrowRightToLine,
  Calendar,
  CheckSquare,
  ChevronRight,
  CircleChevronDown,
  Copy,
  EyeOff,
  Filter,
  Hash,
  Link2,
  List,
  Pin,
  PinOff,
  Repeat,
  SlidersHorizontal,
  Trash2,
  Type,
  User,
  AlignLeft,
  type LucideIcon,
} from "lucide-react";
import AnchoredPanel, { useAnchoredPanel } from "@/components/AnchoredPanel";
import { useAvisar } from "@/components/Toasts";
import { LinhaDeOpcao, criarOpcao } from "@/components/bases/MenuDaColuna";
import {
  ApiError,
  createBaseColumn,
  deleteBaseColumn,
  deleteBaseOption,
  duplicateBaseColumn,
  updateBaseColumn,
  type BaseColumn,
  type BaseColumnType,
  type BaseOptionColor,
} from "@/lib/api";
import { NOME_DO_TIPO, TIPOS_ESCOLHIVEIS } from "@/lib/baseTable";
import { operadoresDo, type ConfigDaVisao } from "@/lib/baseViews";

export const ICONE_DO_TIPO: Record<BaseColumnType, LucideIcon> = {
  title: Type,
  text: AlignLeft,
  number: Hash,
  date: Calendar,
  select: CircleChevronDown,
  multi_select: List,
  person: User,
  link: Link2,
  checkbox: CheckSquare,
};

type Submenu = "editar" | "tipo" | "ordenar" | null;

export default function CabecalhoDaColuna({
  baseId,
  coluna,
  podeEditar,
  podeCriar,
  podeApagar,
  podeEditarVisao,
  config,
  onConfig,
  onMudou,
  onApagou,
  onCriou,
}: {
  baseId: string;
  coluna: BaseColumn;
  podeEditar: boolean;
  podeCriar: boolean;
  podeApagar: boolean;
  podeEditarVisao: boolean;
  config: ConfigDaVisao;
  onConfig: (c: ConfigDaVisao) => void;
  /** A coluna como o servidor a devolveu; `zerou` = trocou de tipo. */
  onMudou: (c: BaseColumn, zerou: boolean) => void;
  onApagou: (id: string) => void;
  /** Coluna nova (inserir, duplicar). A página recarrega -- as outras andaram. */
  onCriou: () => void;
}) {
  const avisar = useAvisar();
  const eTitulo = coluna.type === "title";
  const temOpcoes = coluna.type === "select" || coluna.type === "multi_select";
  const Icone = ICONE_DO_TIPO[coluna.type];

  const [aberto, setAberto] = useState(false);
  const [sub, setSub] = useState<Submenu>(null);
  const [nome, setNome] = useState(coluna.name);
  const [ocupado, setOcupado] = useState(false);
  const subRef = useRef<HTMLDivElement | null>(null);
  const fechar = () => {
    setSub(null);
    setAberto(false);
  };
  const principal = useAnchoredPanel<HTMLButtonElement>(aberto, fechar, {
    larguraPainel: 260,
    dentro: [subRef],
  });

  const algumaAcao =
    podeEditar || podeCriar || podeEditarVisao || (podeApagar && !eTitulo);
  if (!algumaAcao) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <Icone size={14} aria-hidden="true" className="shrink-0 text-ink-faint" />
        <span className="min-w-0 truncate">{coluna.name}</span>
      </span>
    );
  }

  async function rodar(acao: () => Promise<void>, falha: string) {
    setOcupado(true);
    try {
      await acao();
    } catch (e) {
      avisar((e as ApiError).message || falha);
    } finally {
      setOcupado(false);
    }
  }

  const salvarNome = () =>
    rodar(async () => {
      const limpo = nome.trim();
      if (!limpo || limpo === coluna.name) {
        setNome(coluna.name);
        return;
      }
      onMudou(await updateBaseColumn(baseId, coluna.id, { name: limpo }), false);
    }, "Não consegui renomear a coluna.");

  const visao = (c: ConfigDaVisao, aviso?: string) => {
    onConfig(c);
    if (aviso) avisar(aviso);
    fechar();
  };

  const inserir = (lado: "esquerda" | "direita") =>
    rodar(async () => {
      await createBaseColumn(baseId, {
        name: "Nova coluna",
        type: "text",
        position: lado === "esquerda" ? coluna.position : coluna.position + 1,
      });
      fechar();
      onCriou();
    }, "Não consegui criar a coluna.");

  const duplicar = () =>
    rodar(async () => {
      await duplicateBaseColumn(baseId, coluna.id);
      fechar();
      onCriou();
    }, "Não consegui duplicar a coluna.");

  const excluir = () =>
    rodar(async () => {
      await deleteBaseColumn(baseId, coluna.id);
      fechar();
      onApagou(coluna.id);
    }, "Não consegui excluir a coluna.");

  const congelada = config.frozen_column === coluna.id;

  return (
    <>
      <button
        ref={principal.anchorRef}
        type="button"
        className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent px-0 py-0 text-left font-semibold text-ink-soft hover:text-ink"
        aria-haspopup="dialog"
        aria-expanded={aberto}
        aria-label={`Coluna ${coluna.name}, ${NOME_DO_TIPO[coluna.type]}`}
        onClick={() => {
          setNome(coluna.name);
          setSub(null);
          setAberto((a) => !a);
        }}
      >
        <Icone size={14} aria-hidden="true" className="shrink-0 text-ink-faint" />
        <span className="min-w-0 truncate">{coluna.name}</span>
      </button>

      {aberto && principal.box && (
        <AnchoredPanel
          box={principal.box}
          panelRef={principal.panelRef}
          role="dialog"
          aria-label={`Coluna ${coluna.name}`}
          minWidth={260}
        >
          <div className="flex flex-col p-0.5">
            <div className="mb-1 flex items-center gap-2 px-1">
              <Icone size={16} aria-hidden="true" className="shrink-0 text-ink-faint" />
              <input
                className="input min-w-0 flex-1"
                aria-label="Nome da coluna"
                value={nome}
                disabled={!podeEditar || ocupado}
                autoFocus={podeEditar}
                onChange={(e) => setNome(e.target.value)}
                onBlur={salvarNome}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    salvarNome();
                  }
                }}
              />
            </div>

            {temOpcoes && (podeEditar || podeApagar) && (
              <ItemComSub
                rotulo="Editar propriedade"
                icone={SlidersHorizontal}
                aberto={sub === "editar"}
                onAbrir={() => setSub(sub === "editar" ? null : "editar")}
                subRef={subRef}
                largura={300}
              >
                <EditarOpcoes
                  baseId={baseId}
                  coluna={coluna}
                  podeEditar={podeEditar}
                  podeApagar={podeApagar}
                  onMudou={(c) => onMudou(c, false)}
                />
              </ItemComSub>
            )}
            {podeEditar && !eTitulo && (
              <ItemComSub
                rotulo="Alterar tipo"
                icone={Repeat}
                aberto={sub === "tipo"}
                onAbrir={() => setSub(sub === "tipo" ? null : "tipo")}
                subRef={subRef}
                largura={260}
              >
                <AlterarTipo
                  coluna={coluna}
                  ocupado={ocupado}
                  onTrocar={(tipo) =>
                    rodar(async () => {
                      onMudou(await updateBaseColumn(baseId, coluna.id, { type: tipo }), true);
                      fechar();
                    }, "Não consegui trocar o tipo.")
                  }
                />
              </ItemComSub>
            )}

            {podeEditarVisao && (
              <>
                <Separador />
                <Item
                  rotulo="Filtrar"
                  icone={Filter}
                  onClick={() =>
                    visao(
                      {
                        ...config,
                        filters: [
                          ...config.filters,
                          { column_id: coluna.id, operator: operadoresDo(coluna.type)[0].id },
                        ],
                      },
                      `Filtro de "${coluna.name}" criado. Ajuste o valor em "Filtro".`
                    )
                  }
                />
                <ItemComSub
                  rotulo="Ordenar"
                  icone={ArrowDownUp}
                  aberto={sub === "ordenar"}
                  onAbrir={() => setSub(sub === "ordenar" ? null : "ordenar")}
                  subRef={subRef}
                  largura={200}
                >
                  {(["asc", "desc"] as const).map((d) => (
                    <Item
                      key={d}
                      rotulo={d === "asc" ? "Crescente" : "Decrescente"}
                      onClick={() =>
                        visao({ ...config, sorts: [{ column_id: coluna.id, direction: d }] })
                      }
                    />
                  ))}
                </ItemComSub>
                <Item
                  rotulo={congelada ? "Descongelar" : "Congelar"}
                  icone={congelada ? PinOff : Pin}
                  onClick={() =>
                    visao({ ...config, frozen_column: congelada ? null : coluna.id })
                  }
                />
                {!eTitulo && (
                  <Item
                    rotulo="Ocultar"
                    icone={EyeOff}
                    onClick={() =>
                      visao({ ...config, hidden_columns: [...config.hidden_columns, coluna.id] })
                    }
                  />
                )}
              </>
            )}

            {podeCriar && (
              <>
                <Separador />
                {!eTitulo && (
                  <Item
                    rotulo="Inserir à esquerda"
                    icone={ArrowLeftToLine}
                    disabled={ocupado}
                    onClick={() => inserir("esquerda")}
                  />
                )}
                <Item
                  rotulo="Inserir à direita"
                  icone={ArrowRightToLine}
                  disabled={ocupado}
                  onClick={() => inserir("direita")}
                />
                {!eTitulo && (
                  <Item
                    rotulo="Duplicar propriedade"
                    icone={Copy}
                    disabled={ocupado}
                    onClick={duplicar}
                  />
                )}
              </>
            )}
            {podeApagar && !eTitulo && (
              <Item
                rotulo="Excluir propriedade"
                icone={Trash2}
                perigo
                disabled={ocupado}
                onClick={excluir}
              />
            )}
          </div>
        </AnchoredPanel>
      )}
    </>
  );
}

// ------------------------------------------------------------------ peças
function Separador() {
  return <div className="my-1 h-px bg-border" role="separator" />;
}

function Item({
  rotulo,
  icone: Icone,
  onClick,
  disabled,
  perigo,
}: {
  rotulo: string;
  icone?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  perigo?: boolean;
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-sm hover:bg-surface-2 disabled:opacity-50 ${
        perigo ? "text-danger" : "text-ink"
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="flex w-4 shrink-0 justify-center" aria-hidden="true">
        {Icone && <Icone size={15} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{rotulo}</span>
    </button>
  );
}

/** Um item com "›" que abre o SUBMENU AO LADO. O submenu mora fora do painel
 *  principal (é outro `fixed`), dentro de `subRef` -- é por esse ref que o
 *  principal sabe que um clique lá é "dentro". */
function ItemComSub({
  rotulo,
  icone: Icone,
  aberto,
  onAbrir,
  subRef,
  largura,
  children,
}: {
  rotulo: string;
  icone: LucideIcon;
  aberto: boolean;
  onAbrir: () => void;
  subRef: MutableRefObject<HTMLDivElement | null>;
  largura: number;
  children: ReactNode;
}) {
  const { anchorRef, panelRef, box } = useAnchoredPanel<HTMLButtonElement>(
    aberto,
    () => aberto && onAbrir(),
    { aoLado: true, larguraPainel: largura }
  );
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`flex w-full items-center gap-2 rounded-md border-0 px-2 py-1.5 text-left text-sm text-ink hover:bg-surface-2 ${
          aberto ? "bg-surface-2" : "bg-transparent"
        }`}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        onClick={onAbrir}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" && !aberto) {
            e.preventDefault();
            onAbrir();
          }
        }}
      >
        <span className="flex w-4 shrink-0 justify-center" aria-hidden="true">
          <Icone size={15} />
        </span>
        <span className="min-w-0 flex-1 truncate">{rotulo}</span>
        <ChevronRight size={14} aria-hidden="true" className="text-ink-faint" />
      </button>
      {aberto && box && (
        <SubmenuNoPortal subRef={subRef}>
          <AnchoredPanel box={box} panelRef={panelRef} role="dialog" aria-label={rotulo} minWidth={largura}>
            {children}
          </AnchoredPanel>
        </SubmenuNoPortal>
      )}
    </>
  );
}

/** ⚠️ O submenu NÃO pode ser filho do painel principal na árvore do DOM: o
 *  principal tem `will-change: transform`, e isso faz o `fixed` de dentro ser
 *  posicionado pela caixa dele, e não pela janela. Por isso ele vai para o
 *  `body` -- e o `subRef` é o que diz ao principal que ali é "dentro". */
function SubmenuNoPortal({
  subRef,
  children,
}: {
  subRef: MutableRefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return createPortal(<div ref={subRef}>{children}</div>, document.body);
}

function AlterarTipo({
  coluna,
  ocupado,
  onTrocar,
}: {
  coluna: BaseColumn;
  ocupado: boolean;
  onTrocar: (t: BaseColumnType) => void;
}) {
  const [escolhido, setEscolhido] = useState<BaseColumnType | null>(null);
  if (escolhido) {
    return (
      <div className="flex flex-col gap-2 p-1" role="alert">
        <p className="m-0 text-xs text-danger">
          Trocar para {NOME_DO_TIPO[escolhido]} apaga os valores desta coluna em todas as
          linhas. O Ctrl+Z traz de volta.
        </p>
        <div className="flex gap-2">
          <button className="btn btn-danger" disabled={ocupado} onClick={() => onTrocar(escolhido)}>
            Trocar tipo
          </button>
          <button className="btn btn-ghost" onClick={() => setEscolhido(null)}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {TIPOS_ESCOLHIVEIS.map((t) => {
        const I = ICONE_DO_TIPO[t];
        const atual = t === coluna.type;
        return (
          <button
            key={t}
            type="button"
            aria-current={atual ? "true" : undefined}
            className={`flex w-full items-center gap-2 rounded-md border-0 px-2 py-1.5 text-left text-sm hover:bg-surface-2 ${
              atual ? "bg-accent-soft text-accent" : "bg-transparent text-ink"
            }`}
            onClick={() => !atual && setEscolhido(t)}
          >
            <I size={15} aria-hidden="true" />
            {NOME_DO_TIPO[t]}
          </button>
        );
      })}
    </div>
  );
}

function EditarOpcoes({
  baseId,
  coluna,
  podeEditar,
  podeApagar,
  onMudou,
}: {
  baseId: string;
  coluna: BaseColumn;
  podeEditar: boolean;
  podeApagar: boolean;
  onMudou: (c: BaseColumn) => void;
}) {
  const avisar = useAvisar();
  const [nova, setNova] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function rodar(acao: () => Promise<void>) {
    setOcupado(true);
    try {
      await acao();
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui salvar a opção.");
    } finally {
      setOcupado(false);
    }
  }
  const salvarOpcao = (id: string, m: { label?: string; color?: BaseOptionColor }) =>
    rodar(async () => {
      const opcoes = coluna.options.map((o) =>
        o.id === id
          ? { id: o.id, label: m.label ?? o.label, color: m.color ?? o.color }
          : { id: o.id, label: o.label, color: o.color }
      );
      onMudou(await updateBaseColumn(baseId, coluna.id, { options: opcoes }));
    });

  return (
    <div className="flex flex-col gap-2 p-1">
      <span className="label">Opções</span>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {coluna.options.map((o) => (
          <LinhaDeOpcao
            key={o.id}
            rotulo={o.label}
            cor={o.color}
            podeEditar={podeEditar}
            podeApagar={podeApagar}
            ocupado={ocupado}
            onRenomear={(label) => salvarOpcao(o.id, { label })}
            onCor={(color) => salvarOpcao(o.id, { color })}
            onApagar={() => rodar(async () => onMudou(await deleteBaseOption(baseId, coluna.id, o.id)))}
          />
        ))}
        {coluna.options.length === 0 && <li className="muted text-xs">Nenhuma opção ainda.</li>}
      </ul>
      {podeEditar && (
        <input
          className="input"
          aria-label="Nova opção"
          placeholder="Nova opção…"
          value={nova}
          disabled={ocupado}
          onChange={(e) => setNova(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && nova.trim()) {
              e.preventDefault();
              const rotulo = nova.trim();
              rodar(async () => {
                onMudou(await criarOpcao(baseId, coluna, rotulo));
                setNova("");
              });
            }
          }}
        />
      )}
    </div>
  );
}
