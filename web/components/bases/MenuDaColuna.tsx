"use client";
// components/bases/MenuDaColuna.tsx
// O menu de uma coluna da Base (Spec 056, fatia E): renomear, trocar o tipo,
// editar as opções e apagar. E o "+" que cria coluna.
//
// ⚠️ CADA BLOCO PERGUNTA O SEU CADEADO, vindo do servidor: editar coluna
// (`can_update_column`, que inclui trocar tipo -- D24) e apagar
// (`can_delete_column`, que inclui apagar OPÇÃO -- D17). Hoje todos os papéis
// têm os dois; o dia em que não tiverem, a tela já obedece.
//
// ⚠️ TROCAR O TIPO ZERA A COLUNA (D18), e por isso pede um segundo clique com
// o aviso escrito -- o gesto é o mesmo de escolher num `<select>`, e a cor
// sozinha não avisa. O Ctrl+Z de 1 dia volta tudo (fatia H).

import { useRef, useState } from "react";
import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import AnchoredPanel, { useAnchoredPanel } from "@/components/AnchoredPanel";
import { useAvisar } from "@/components/Toasts";
import {
  ApiError,
  createBaseColumn,
  deleteBaseColumn,
  deleteBaseOption,
  updateBaseColumn,
  type BaseColumn,
  type BaseColumnType,
  type BaseOptionColor,
} from "@/lib/api";
import {
  CORES_DE_OPCAO,
  NOME_DA_COR,
  NOME_DO_TIPO,
  TIPOS_ESCOLHIVEIS,
  proximaCor,
} from "@/lib/baseTable";

export function MenuDaColuna({
  baseId,
  coluna,
  podeEditar,
  podeApagar,
  onMudou,
  onApagou,
}: {
  baseId: string;
  coluna: BaseColumn;
  podeEditar: boolean;
  podeApagar: boolean;
  /** A coluna como o servidor a devolveu; `zerou` = trocou de tipo. */
  onMudou: (c: BaseColumn, zerou: boolean) => void;
  onApagou: (id: string) => void;
}) {
  const avisar = useAvisar();
  const [aberto, setAberto] = useState(false);
  const { anchorRef, panelRef, box } = useAnchoredPanel<HTMLButtonElement>(
    aberto,
    () => setAberto(false),
    { larguraPainel: 300 }
  );
  const [nome, setNome] = useState(coluna.name);
  const [tipoNovo, setTipoNovo] = useState<BaseColumnType | "">("");
  const [ocupado, setOcupado] = useState(false);
  const eTitulo = coluna.type === "title";
  const temOpcoes = coluna.type === "select" || coluna.type === "multi_select";

  if (!podeEditar && !(podeApagar && !eTitulo)) return null;

  async function rodar(acao: () => Promise<void>) {
    setOcupado(true);
    try {
      await acao();
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui salvar a coluna.");
    } finally {
      setOcupado(false);
    }
  }

  const salvarNome = () =>
    rodar(async () => {
      const limpo = nome.trim();
      if (!limpo || limpo === coluna.name) return;
      onMudou(await updateBaseColumn(baseId, coluna.id, { name: limpo }), false);
    });

  const trocarTipo = () =>
    rodar(async () => {
      if (!tipoNovo) return;
      onMudou(await updateBaseColumn(baseId, coluna.id, { type: tipoNovo }), true);
      setTipoNovo("");
      setAberto(false);
    });

  const salvarOpcao = (id: string, mudanca: { label?: string; color?: BaseOptionColor }) =>
    rodar(async () => {
      const opcoes = coluna.options.map((o) =>
        o.id === id ? { id: o.id, label: mudanca.label ?? o.label, color: mudanca.color ?? o.color }
          : { id: o.id, label: o.label, color: o.color }
      );
      onMudou(await updateBaseColumn(baseId, coluna.id, { options: opcoes }), false);
    });

  const apagarOpcao = (id: string) =>
    rodar(async () => onMudou(await deleteBaseOption(baseId, coluna.id, id), false));

  const apagarColuna = () =>
    rodar(async () => {
      await deleteBaseColumn(baseId, coluna.id);
      setAberto(false);
      onApagou(coluna.id);
    });

  return (
    <>
      <button
        ref={anchorRef}
        className="btn btn-ghost shrink-0"
        style={{ padding: "2px 4px" }}
        aria-label={`Opções da coluna ${coluna.name}`}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        onClick={() => {
          setNome(coluna.name);
          setAberto((a) => !a);
        }}
      >
        <MoreHorizontal size={14} aria-hidden="true" />
      </button>
      {aberto && box && (
        <AnchoredPanel box={box} panelRef={panelRef} role="dialog" aria-label={`Coluna ${coluna.name}`} minWidth={300}>
          <div className="flex flex-col gap-3 p-1">
            {podeEditar && (
              <div className="field">
                <label className="label" htmlFor={`nome-${coluna.id}`}>
                  Nome
                </label>
                <input
                  id={`nome-${coluna.id}`}
                  className="input"
                  value={nome}
                  disabled={ocupado}
                  onChange={(e) => setNome(e.target.value)}
                  onBlur={salvarNome}
                  onKeyDown={(e) => e.key === "Enter" && salvarNome()}
                />
              </div>
            )}

            {podeEditar && !eTitulo && (
              <div className="field">
                <label className="label" htmlFor={`tipo-${coluna.id}`}>
                  Tipo
                </label>
                <select
                  id={`tipo-${coluna.id}`}
                  className="input"
                  value={tipoNovo || coluna.type}
                  disabled={ocupado}
                  onChange={(e) =>
                    setTipoNovo(
                      e.target.value === coluna.type ? "" : (e.target.value as BaseColumnType)
                    )
                  }
                >
                  {TIPOS_ESCOLHIVEIS.map((t) => (
                    <option key={t} value={t}>
                      {NOME_DO_TIPO[t]}
                    </option>
                  ))}
                </select>
                {tipoNovo && (
                  <div className="mt-2 flex flex-col gap-2" role="alert">
                    <p className="m-0 text-xs text-danger">
                      Trocar para {NOME_DO_TIPO[tipoNovo]} apaga os valores desta coluna em
                      todas as linhas.
                    </p>
                    <div className="flex gap-2">
                      <button className="btn btn-danger" disabled={ocupado} onClick={trocarTipo}>
                        Trocar tipo
                      </button>
                      <button className="btn btn-ghost" onClick={() => setTipoNovo("")}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {temOpcoes && (podeEditar || podeApagar) && coluna.options.length > 0 && (
              <div className="field">
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
                      onApagar={() => apagarOpcao(o.id)}
                    />
                  ))}
                </ul>
              </div>
            )}

            {podeApagar && !eTitulo && (
              <button
                className="btn btn-ghost justify-start text-danger"
                disabled={ocupado}
                onClick={apagarColuna}
              >
                <Trash2 size={14} aria-hidden="true" /> Apagar coluna
              </button>
            )}
          </div>
        </AnchoredPanel>
      )}
    </>
  );
}

function LinhaDeOpcao({
  rotulo,
  cor,
  podeEditar,
  podeApagar,
  ocupado,
  onRenomear,
  onCor,
  onApagar,
}: {
  rotulo: string;
  cor: BaseOptionColor;
  podeEditar: boolean;
  podeApagar: boolean;
  ocupado: boolean;
  onRenomear: (label: string) => void;
  onCor: (cor: BaseOptionColor) => void;
  onApagar: () => void;
}) {
  const [texto, setTexto] = useState(rotulo);
  const salvar = () => {
    const limpo = texto.trim();
    if (limpo && limpo !== rotulo) onRenomear(limpo);
    else setTexto(rotulo);
  };
  return (
    <li className="flex items-center gap-1">
      <input
        className="input min-w-0 flex-1"
        aria-label={`Nome da opção ${rotulo}`}
        value={texto}
        disabled={!podeEditar || ocupado}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={salvar}
        onKeyDown={(e) => e.key === "Enter" && salvar()}
      />
      <select
        className="input w-[96px]"
        aria-label={`Cor da opção ${rotulo}`}
        value={cor}
        disabled={!podeEditar || ocupado}
        onChange={(e) => onCor(e.target.value as BaseOptionColor)}
      >
        {CORES_DE_OPCAO.map((c) => (
          <option key={c} value={c}>
            {NOME_DA_COR[c]}
          </option>
        ))}
      </select>
      {podeApagar && (
        <button
          className="btn btn-ghost text-danger"
          style={{ padding: "4px 6px" }}
          aria-label={`Apagar a opção ${rotulo}`}
          disabled={ocupado}
          onClick={onApagar}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

export function NovaColuna({
  baseId,
  onCriou,
}: {
  baseId: string;
  onCriou: (c: BaseColumn) => void;
}) {
  const avisar = useAvisar();
  const [aberto, setAberto] = useState(false);
  const { anchorRef, panelRef, box } = useAnchoredPanel<HTMLButtonElement>(
    aberto,
    () => setAberto(false),
    { larguraPainel: 260, alinhar: "direita" }
  );
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<BaseColumnType>("text");
  const [ocupado, setOcupado] = useState(false);
  const nomeRef = useRef<HTMLInputElement>(null);

  async function criar() {
    const limpo = nome.trim();
    if (!limpo) {
      nomeRef.current?.focus();
      return;
    }
    setOcupado(true);
    try {
      onCriou(await createBaseColumn(baseId, { name: limpo, type: tipo }));
      setNome("");
      setTipo("text");
      setAberto(false);
    } catch (e) {
      avisar((e as ApiError).message || "Não consegui criar a coluna.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <button
        ref={anchorRef}
        className="btn btn-ghost"
        style={{ padding: "2px 6px" }}
        aria-label="Nova coluna"
        aria-haspopup="dialog"
        aria-expanded={aberto}
        onClick={() => setAberto((a) => !a)}
      >
        <Plus size={16} aria-hidden="true" />
      </button>
      {aberto && box && (
        <AnchoredPanel box={box} panelRef={panelRef} role="dialog" aria-label="Nova coluna" minWidth={260}>
          <div className="flex flex-col gap-3 p-1">
            <div className="field">
              <label className="label" htmlFor="nova-coluna-nome">
                Nome
              </label>
              <input
                id="nova-coluna-nome"
                ref={nomeRef}
                className="input"
                autoFocus
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && criar()}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="nova-coluna-tipo">
                Tipo
              </label>
              <select
                id="nova-coluna-tipo"
                className="input"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as BaseColumnType)}
              >
                {TIPOS_ESCOLHIVEIS.map((t) => (
                  <option key={t} value={t}>
                    {NOME_DO_TIPO[t]}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary" disabled={ocupado} onClick={criar}>
              {ocupado ? "Criando…" : "Criar coluna"}
            </button>
          </div>
        </AnchoredPanel>
      )}
    </>
  );
}

/** A opção nova que a célula de seleção cria digitando. Devolve a coluna. */
export async function criarOpcao(
  baseId: string,
  coluna: BaseColumn,
  rotulo: string
): Promise<BaseColumn> {
  const opcoes = coluna.options.map((o) => ({ id: o.id, label: o.label, color: o.color }));
  return updateBaseColumn(baseId, coluna.id, {
    options: [...opcoes, { label: rotulo, color: proximaCor(coluna.options.map((o) => o.color)) }],
  });
}
