"use client";
// components/bases/QuadroDaBase.tsx
// A visão de QUADRO da Base (Spec 056, fatia F, §8): uma coluna por opção de
// uma coluna de Seleção (`group_by`), mais "Sem valor".
//
// ⚠️ MOVER UM CARD É EDITAR A CÉLULA da coluna de agrupamento -- a mesma
// gravação da tabela, com o mesmo cadeado (`can_update_row`).
//
// ⚠️⚠️ DUAS MANEIRAS DE MOVER, E A SEGUNDA NÃO É ENFEITE: arrastar (mouse) e o
// seletor "Mover para" no card (teclado). O `web/AGENTS.md` §1 registra que o
// quadro de TAREFAS não tem alternativa de teclado ao arraste -- violação aceita
// lá, e que este não repete.

import { useState } from "react";
import Badge from "@/components/Badge";
import type { BaseCellValue, BaseColumn, BaseRow } from "@/lib/api";
import { corDaOpcao, textoDaCelula } from "@/lib/baseTable";
import { agruparNoQuadro } from "@/lib/baseViews";

export default function QuadroDaBase({
  linhas,
  colunas,
  agrupar,
  podeEditar,
  onGravar,
}: {
  linhas: BaseRow[];
  colunas: BaseColumn[];
  agrupar: BaseColumn;
  podeEditar: boolean;
  onGravar: (linha: BaseRow, coluna: BaseColumn, valor: BaseCellValue | null) => void;
}) {
  const titulo = colunas.find((c) => c.type === "title");
  const grupos = agruparNoQuadro(linhas, agrupar);
  const [sobre, setSobre] = useState<string | null>(null);

  function mover(linhaId: string, opcaoId: string | null) {
    const linha = linhas.find((l) => l.id === linhaId);
    if (linha) onGravar(linha, agrupar, opcaoId);
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {grupos.map((g) => {
        const chave = g.opcaoId ?? "sem-valor";
        const opcao = agrupar.options.find((o) => o.id === g.opcaoId);
        return (
          <section
            key={chave}
            aria-label={`${g.rotulo}, ${g.linhas.length}`}
            className={`flex w-[260px] shrink-0 flex-col gap-2 rounded-md border bg-surface-2 p-2 ${
              sobre === chave ? "border-accent" : "border-border"
            }`}
            onDragOver={(e) => {
              if (!podeEditar) return;
              e.preventDefault();
              setSobre(chave);
            }}
            onDragLeave={() => setSobre((s) => (s === chave ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setSobre(null);
              const id = e.dataTransfer.getData("text/plain");
              if (id) mover(id, g.opcaoId);
            }}
          >
            <header className="flex items-center gap-2 px-1">
              {opcao ? (
                <Badge tone="soft" color={corDaOpcao(opcao.color)}>
                  {g.rotulo}
                </Badge>
              ) : (
                <span className="text-sm font-semibold text-ink-soft">{g.rotulo}</span>
              )}
              <span className="muted text-xs">{g.linhas.length}</span>
            </header>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {g.linhas.map((l) => (
                <li
                  key={l.id}
                  draggable={podeEditar}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)}
                  className="flex flex-col gap-2 rounded-md border border-border bg-surface p-2"
                >
                  <span className="min-w-0 break-words text-sm font-medium">
                    {(titulo && textoDaCelula(titulo, l.values[titulo.id])) || "Sem título"}
                  </span>
                  {podeEditar && (
                    <select
                      className="input text-xs"
                      aria-label={`Mover "${(titulo && textoDaCelula(titulo, l.values[titulo.id])) || "Sem título"}" para`}
                      value={g.opcaoId ?? ""}
                      onChange={(e) => mover(l.id, e.target.value || null)}
                    >
                      {agrupar.options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                      <option value="">Sem valor</option>
                    </select>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
