"use client";
// components/bases/CalendarioDaBase.tsx
// A visão de CALENDÁRIO da Base (Spec 056, fatia F, §8): o mês, com cada linha
// no dia da coluna de data (`date_column`). As sem data numa lista ao lado.
//
// ⚠️⚠️ A JANELA É MONTADA SEM `Date` (`diasDaJanela` em `lib/baseViews.ts`): a
// célula guarda só o DIA, e o `Date` o leria à meia-noite UTC -- que em
// Brasília é o dia anterior (web/AGENTS.md §0.1). "Hoje" vem de
// `agoraNoWorkspace`, no fuso do workspace.
//
// ⚠️ FATIA J: NÃO É MAIS "UM MÊS", É UMA JANELA DE SEMANAS INTEIRAS, que anda
// de semana em semana ou de mês em mês. Pedido dela: queria ver quatro semanas
// que atravessam dois meses, e mover um item para 30/09 olhando outubro. Os
// dias de fora do mês do título aparecem mais apagados, mas recebem o arraste
// como qualquer outro.
//
// ⚠️ ARRASTAR PARA OUTRO DIA É EDITAR A CÉLULA DE DATA. A alternativa de
// teclado é a própria célula, na visão de tabela -- o calendário não repete um
// editor de data em cada linha.

import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import type { BaseCellValue, BaseColumn, BaseRow } from "@/lib/api";
import { textoDaCelula } from "@/lib/baseTable";
import {
  NOME_DO_MES,
  andarJanela,
  diasDaJanela,
  janelaDoMes,
  linhasPorDia,
  mesDaJanela,
  rotuloDoDia,
  type JanelaDoCalendario,
} from "@/lib/baseViews";
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
  const mesDeHoje = () => janelaDoMes(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)));
  const [janela, setJanela] = useState<JanelaDoCalendario>(mesDeHoje);
  const [sobre, setSobre] = useState<string | null>(null);
  const titulo = colunas.find((c) => c.type === "title");
  const { porDia, semData } = linhasPorDia(linhas, data);
  const nomeDe = (l: BaseRow) =>
    (titulo && textoDaCelula(titulo, l.values[titulo.id])) || "Sem título";
  const doTitulo = mesDaJanela(janela);
  const semanas = diasDaJanela(janela);
  const ultimo = semanas[semanas.length - 1][6];
  const curto = (dia: string) => `${dia.slice(8)}/${dia.slice(5, 7)}`;

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

  // ⚠️ Função, e não componente: um componente declarado aqui dentro nasceria
  // outro a cada render, e o botão clicado perderia o foco -- quem anda de
  // semana em semana pelo teclado teria de voltar ao botão a cada passo.
  const passo = (rotulo: string, icone: ReactNode, para: () => JanelaDoCalendario) => (
    <button
      key={rotulo}
      className="btn btn-ghost"
      style={{ padding: "2px 6px" }}
      aria-label={rotulo}
      title={rotulo}
      onClick={() => setJanela(para())}
    >
      {icone}
    </button>
  );

  return (
    <div className="flex min-w-0 gap-3">
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center gap-1">
          {passo("Mês anterior", <ChevronsLeft size={16} aria-hidden="true" />, () =>
            andarJanela(janela, "mes", -1)
          )}
          {passo("Semana anterior", <ChevronLeft size={16} aria-hidden="true" />, () =>
            andarJanela(janela, "semana", -1)
          )}
          <h2 className="m-0 min-w-[160px] text-center text-lg font-semibold" aria-live="polite">
            {NOME_DO_MES[doTitulo.mes - 1]} de {doTitulo.ano}
            <span className="sr-only">
              , de {curto(janela.inicio)} a {curto(ultimo)}
            </span>
          </h2>
          {passo("Próxima semana", <ChevronRight size={16} aria-hidden="true" />, () =>
            andarJanela(janela, "semana", 1)
          )}
          {passo("Próximo mês", <ChevronsRight size={16} aria-hidden="true" />, () =>
            andarJanela(janela, "mes", 1)
          )}
          <button className="btn btn-ghost ml-1 text-sm" onClick={() => setJanela(mesDeHoje())}>
            Hoje
          </button>
          <span className="muted ml-2 text-xs" aria-hidden="true">
            {curto(janela.inicio)} – {curto(ultimo)}
          </span>
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
            {semanas.map((semana) => (
              <tr key={semana[0]}>
                {semana.map((dia) => {
                  const doMes = Number(dia.slice(5, 7)) === doTitulo.mes;
                  return (
                    <td
                      key={dia}
                      className={`h-24 border border-border p-1 align-top ${
                        sobre === dia ? "outline outline-2 -outline-offset-2 outline-accent" : ""
                      }`}
                      onDragOver={(e) => {
                        if (!podeEditar) return;
                        e.preventDefault();
                        setSobre(dia);
                      }}
                      onDragLeave={() => setSobre((s) => (s === dia ? null : s))}
                      onDrop={(e) => {
                        e.preventDefault();
                        setSobre(null);
                        const id = e.dataTransfer.getData("text/plain");
                        if (id) soltar(id, dia);
                      }}
                    >
                      <span
                        className={`text-xs ${
                          dia === hoje
                            ? "font-bold text-accent"
                            : doMes
                              ? "text-ink-soft"
                              : "text-ink-faint"
                        }`}
                        aria-label={dia === hoje ? `${rotuloDoDia(dia)}, hoje` : undefined}
                      >
                        {rotuloDoDia(dia)}
                      </span>
                      <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
                        {(porDia.get(dia) ?? []).map((l) => (
                          <Item key={l.id} l={l} />
                        ))}
                      </ul>
                    </td>
                  );
                })}
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
