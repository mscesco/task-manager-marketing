"use client";
// A aba "Atividade" do detalhe da tarefa. Só desenha: o texto e o agrupamento
// dos eventos vêm de `lib/historicoDaTarefa.ts`. Uma linha por gesto: eventos
// da mesma transação têm o mesmo horário e ordem arbitrária.

import { dataHoraCurta } from "@/lib/prazo";
import {
  agruparPorInstante,
  semParesQueSeAnulam,
  type EventoDeHistorico,
  type NomesDoHistorico,
} from "@/lib/historicoDaTarefa";

export default function AtividadeDaTarefa({
  itens,
  total,
  nomes,
  carregando,
  erro,
  erroAoCarregarMais = null,
  onCarregarMais,
}: {
  itens: readonly EventoDeHistorico[];
  /** Quantos existem no servidor — o botão de carregar mais depende disto. */
  total: number;
  nomes: NomesDoHistorico;
  carregando: boolean;
  erro: string | null;
  /** O "Mostrar mais" falhou; separado de `erro` para não sumir com a lista já carregada. */
  erroAoCarregarMais?: string | null;
  onCarregarMais: () => void;
}) {
  if (erro) {
    return (
      <div className="error-box" role="alert">
        {erro}
      </div>
    );
  }

  // Filtra antes de agrupar: o par que se anula não pode virar grupo vazio.
  const grupos = agruparPorInstante(semParesQueSeAnulam(itens), nomes);
  const faltam = total - itens.length;

  return (
    <div className="flex flex-col gap-3">
      {grupos.length === 0 && !carregando ? (
        // Não deveria acontecer: toda tarefa tem o `created`.
        <p className="muted text-sm">Nada registrado ainda.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {grupos.map((g) => (
            // Bolinha da linha do tempo; só visual.
            <li key={g.chave} className="flex gap-2.5">
              <span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full bg-border" />
              <span className="flex min-w-0 flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-base font-semibold">
                  {nomes.pessoa(g.autorId) ?? "Alguém"}
                </span>
                <time className="text-sm text-ink-faint" dateTime={g.quando}>
                  {dataHoraCurta(g.quando)}
                </time>
              </div>
              {/* Uma frase por linha: num gesto com três mudanças, a vírgula
                  faria uma frase longa que ninguém lê até o fim. */}
              {g.frases.map((f, i) => (
                <span key={i} className="text-base text-ink-soft">
                  {f}
                </span>
              ))}
              </span>
            </li>
          ))}
        </ol>
      )}

      {carregando && (
        <p className="muted text-sm" role="status">
          Carregando…
        </p>
      )}

      {erroAoCarregarMais && (
        <p className="text-sm text-danger" role="alert">
          {erroAoCarregarMais}
        </p>
      )}

      {faltam > 0 && !carregando && (
        <button
          type="button"
          className="btn btn-ghost self-start"
          // Padding inline: o `.btn` do globals.css vence `px-*`/`py-*` do Tailwind.
          style={{ padding: "4px 10px", fontSize: 13 }}
          onClick={onCarregarMais}
        >
          Mostrar mais {faltam === 1 ? "(1)" : `(${faltam})`}
        </button>
      )}
    </div>
  );
}
