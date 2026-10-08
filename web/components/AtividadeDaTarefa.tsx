"use client";
// components/AtividadeDaTarefa.tsx
// A aba "Atividade" da coluna lateral do detalhe (Spec 055, fatia C).
//
// ⚠️ SÓ DESENHA. Quem vira evento em frase e quem junta os eventos do mesmo
// gesto é `lib/historicoDaTarefa.ts`, testado isolado — a fronteira da Spec
// 027. Aqui não há nenhuma regra sobre o que o evento significa.
//
// ⚠️ UMA LINHA POR GESTO, e não por evento: criar uma tarefa com responsável
// grava `created` e `assigned` com o MESMO horário ao milissegundo
// (`func.now()` é constante na transação), e a ordem entre eles é arbitrária.
// Agrupar é dizer a verdade sobre o dado em vez de fingir uma sequência.
// Decisão dela, 30/09.
//
// ⚠️ MORA EM `components/`, e não dentro do `TaskDetail`: o arquivo de lá já
// tem 3.4 mil linhas, e o `include` do vitest cobre `components/**` — aqui
// isto tem guardião.

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
  /**
   * O "Mostrar mais" falhou. ⚠️ SEPARADO de `erro` (revisão de 08/10): o
   * mesmo estado trocava a lista inteira pelo aviso, e o que já estava
   * carregado sumia sem jeito de tentar de novo.
   */
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

  // ⚠️ FILTRA ANTES DE AGRUPAR: o par que se anula tem de sumir antes, senão
  // ele contaria como gesto e deixaria um grupo vazio na lista.
  const grupos = agruparPorInstante(semParesQueSeAnulam(itens), nomes);
  const faltam = total - itens.length;

  return (
    <div className="flex flex-col gap-3">
      {grupos.length === 0 && !carregando ? (
        // ⚠️ Não deveria acontecer -- toda tarefa tem pelo menos o `created`.
        // O texto existe para o caso de a rota falhar em silêncio, e não para
        // deixar um painel em branco sem explicação.
        <p className="muted text-sm">Nada registrado ainda.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {grupos.map((g) => (
            <li key={g.chave} className="flex flex-col gap-0.5">
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
          // ⚠️ Padding inline: o `.btn` do globals.css não está em camada e
          // vence `px-*`/`py-*` do Tailwind (web/AGENTS.md §11).
          style={{ padding: "4px 10px", fontSize: 13 }}
          onClick={onCarregarMais}
        >
          Mostrar mais {faltam === 1 ? "(1)" : `(${faltam})`}
        </button>
      )}
    </div>
  );
}
