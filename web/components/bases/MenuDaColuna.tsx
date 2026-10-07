"use client";
// components/bases/MenuDaColuna.tsx
// Peças de coluna da Base que sobraram do menu do "⋯" (Spec 056, fatia E):
// a linha de uma opção (nome, cor, apagar), o "+" que cria coluna no fim, e o
// criar opção digitando.
//
// ⚠️ O MENU DA COLUNA EM SI SAIU NA FATIA I (07/10): o cabeçalho inteiro virou
// o botão, com o menu do Notion -- `CabecalhoDaColuna.tsx`. O "⋯" não existe
// mais, a pedido dela: *"nada de ter que clicar em 3 pontos pra editar"*.

import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import AnchoredPanel, { useAnchoredPanel } from "@/components/AnchoredPanel";
import { useAvisar } from "@/components/Toasts";
import {
  ApiError,
  createBaseColumn,
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

export function LinhaDeOpcao({
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
