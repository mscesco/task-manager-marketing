"use client";
// components/bases/CalendarioDaBase.tsx
// A visão de CALENDÁRIO da Base (Spec 056, fatia F, §8): o mês, com cada linha
// no dia da coluna de data (`date_column`). As sem data numa lista ao lado.
//
// ⚠️⚠️ O MÊS É MONTADO SEM `Date` (`semanasDoMes` em `lib/baseViews.ts`): a
// célula guarda só o DIA, e o `Date` o leria à meia-noite UTC -- que em
// Brasília é o dia anterior (web/AGENTS.md §0.1). "Hoje" vem de
// `agoraNoWorkspace`, no fuso do workspace.
//
// ⚠️ ARRASTAR PARA OUTRO DIA É EDITAR A CÉLULA DE DATA. A alternativa de
// teclado é a própria célula, na visão de tabela -- o calendário não repete um
// editor de data em cada linha.

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { BaseCellValue, BaseColumn, BaseRow } from "@/lib/api";
import { textoDaCelula } from "@/lib/baseTable";
import { NOME_DO_MES, linhasPorDia, mesVizinho, semanasDoMes } from "@/lib/baseViews";
import { agoraNoWorkspace } from "@/lib/prazo";

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export default function CalendarioDaBase({
  linhas,
  colunas,
  data,
  podeEditar,
  onGravar,
}: {
  linhas: BaseRow[];
  colunas: BaseColumn[];
  data: BaseColumn;
  podeEditar: boolean;
  onGravar: (linha: BaseRow, coluna: BaseColumn, valor: BaseCellValue | null) => void;
}) {
  const hoje = agoraNoWorkspace().data;
  const [mes, setMes] = useState(() => ({
    ano: Number(hoje.slice(0, 4)),
    mes: Number(hoje.slice(5, 7)),
  }));
  const [sobre, setSobre] = useState<string | null>(null);
  const titulo = colunas.find((c) => c.type === "title");
  const { porDia, semData } = linhasPorDia(linhas, data);
  const nomeDe = (l: BaseRow) =>
    (titulo && textoDaCelula(titulo, l.values[titulo.id])) || "Sem título";

  function soltar(id: string, dia: string) {
    const linha = linhas.find((l) => l.id === id);
    if (linha) onGravar(linha, data, dia);
  }

  const Item = ({ l }: { l: BaseRow }) => (
    <li
      draggable={podeEditar}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)}
      className="truncate rounded-sm bg-accent-soft px-1 text-xs text-ink"
      title={nomeDe(l)}
    >
      {nomeDe(l)}
    </li>
  );

  return (
    <div className="flex gap-3">
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center gap-2">
          <button
            className="btn btn-ghost"
            style={{ padding: "2px 6px" }}
            aria-label="Mês anterior"
            onClick={() => setMes((m) => mesVizinho(m.ano, m.mes, -1))}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <h2 className="m-0 min-w-[160px] text-center text-lg font-semibold" aria-live="polite">
            {NOME_DO_MES[mes.mes - 1]} de {mes.ano}
          </h2>
          <button
            className="btn btn-ghost"
            style={{ padding: "2px 6px" }}
            aria-label="Próximo mês"
            onClick={() => setMes((m) => mesVizinho(m.ano, m.mes, 1))}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr>
              {DIAS.map((d) => (
                <th key={d} scope="col" className="pb-1 text-left text-xs font-semibold text-ink-soft">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {semanasDoMes(mes.ano, mes.mes).map((semana, i) => (
              <tr key={i}>
                {semana.map((dia, j) => (
                  <td
                    key={dia ?? `vazio-${i}-${j}`}
                    className={`h-24 border border-border p-1 align-top ${
                      dia ? "bg-surface" : "bg-surface-2"
                    } ${sobre === dia ? "outline outline-2 -outline-offset-2 outline-accent" : ""}`}
                    onDragOver={(e) => {
                      if (!dia || !podeEditar) return;
                      e.preventDefault();
                      setSobre(dia);
                    }}
                    onDragLeave={() => setSobre((s) => (s === dia ? null : s))}
                    onDrop={(e) => {
                      e.preventDefault();
                      setSobre(null);
                      const id = e.dataTransfer.getData("text/plain");
                      if (dia && id) soltar(id, dia);
                    }}
                  >
                    {dia && (
                      <>
                        <span
                          className={`text-xs ${dia === hoje ? "font-bold text-accent" : "text-ink-soft"}`}
                          aria-label={dia === hoje ? `${Number(dia.slice(8))}, hoje` : undefined}
                        >
                          {Number(dia.slice(8))}
                        </span>
                        <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
                          {(porDia.get(dia) ?? []).map((l) => (
                            <Item key={l.id} l={l} />
                          ))}
                        </ul>
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <aside className="w-[200px] shrink-0" aria-label="Sem data">
        <h3 className="label mb-1">Sem data ({semData.length})</h3>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {semData.map((l) => (
            <Item key={l.id} l={l} />
          ))}
        </ul>
      </aside>
    </div>
  );
}
