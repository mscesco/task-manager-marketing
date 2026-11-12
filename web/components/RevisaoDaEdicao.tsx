"use client";

import CaixaDeDialogo from "@/components/CaixaDeDialogo";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Coluna } from "@/lib/coluna";
import { avisoDeExclusao, destinoEhTerminal } from "@/lib/edicaoDeColunas";
import {
  colunaDoRascunho,
  ehNova,
  type DestinoPossivel,
} from "@/lib/rascunhoDeColunas";
export type { DestinoPossivel };

/**
 * Revisão ao concluir a edição de colunas: só aparece se houver coluna marcada para
 * apagar, que é irreversível (as tarefas são movidas ou concluídas).
 * As contagens são buscadas agora, não no clique do "×".
 */
export default function RevisaoDaEdicao({
  marcadas,
  destinos,
  contagens,
  resumo,
  erro,
  ocupado,
  onConfirmar,
  onVoltar,
}: {
  marcadas: readonly Coluna[];
  /** As colunas que sobram, incluindo as `tmp:` criadas no rascunho. */
  destinos: readonly DestinoPossivel[];
  /** `id da coluna -> tarefas vivas`. `null` enquanto carrega. */
  contagens: Readonly<Record<string, number>> | null;
  resumo: { criadas: number; renomeadas: number; ordemMudou: boolean };
  erro: string | null;
  ocupado: boolean;
  onConfirmar: (destinos: Record<string, string>) => void;
  onVoltar: () => void;
}) {
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const caixaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    caixaRef.current?.focus();
  }, []);

  const opcoesPorColuna = useMemo(() => {
    const mapa: Record<string, DestinoPossivel[]> = {};
    for (const c of marcadas) {
      // As outras marcadas não entram: o resultado dependeria da ordem das exclusões.
      mapa[c.id] = destinos.filter(
        (d) => d.ref !== c.id && !marcadas.some((m) => m.id === d.ref),
      );
    }
    return mapa;
  }, [marcadas, destinos]);

  // Toda coluna marcada precisa de destino, mesmo a que parece vazia: o backend conta
  // também as tarefas apagadas (FK `task_board_column` é `RESTRICT`).
  useEffect(() => {
    setEscolhas((atuais) => {
      const novo = { ...atuais };
      for (const c of marcadas) {
        const opcoes = opcoesPorColuna[c.id] ?? [];
        if (!novo[c.id] && opcoes.length > 0) {
          const vazia = (contagens?.[c.id] ?? 0) === 0;
          // Só pré-seleciona a coluna que parece vazia: com tarefas, a escolha tem consequência.
          if (vazia) novo[c.id] = opcoes[0].ref;
        }
      }
      return novo;
    });
  }, [marcadas, opcoesPorColuna, contagens]);

  const carregando = contagens === null;
  const faltaEscolher = marcadas.some((c) => !escolhas[c.id]);
  const podeConfirmar = !carregando && !faltaEscolher && !ocupado;

  return (
    <CaixaDeDialogo
      ariaLabel="Revisar alterações das colunas"
      largura={560}
      caixaRef={caixaRef}
      onEsc={ocupado ? undefined : onVoltar}
    >
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
          Revisar alterações
        </h2>

        <ul className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          {resumo.criadas > 0 && (
            <li>
              {resumo.criadas === 1
                ? "1 coluna nova"
                : `${resumo.criadas} colunas novas`}
            </li>
          )}
          {resumo.renomeadas > 0 && (
            <li>
              {resumo.renomeadas === 1
                ? "1 coluna renomeada"
                : `${resumo.renomeadas} colunas renomeadas`}
            </li>
          )}
          {resumo.ordemMudou && <li>A ordem das colunas mudou</li>}
        </ul>

        {carregando ? (
          <div className="muted" style={{ fontSize: 13, marginTop: 12 }}>
            Contando as tarefas…
          </div>
        ) : (
          marcadas.map((coluna) => {
            const opcoes = opcoesPorColuna[coluna.id] ?? [];
            const escolhida = opcoes.find((d) => d.ref === escolhas[coluna.id]);
            const quantas = contagens?.[coluna.id] ?? 0;
            // O destino `tmp:` vira uma `Coluna` provisória só para reusar `avisoDeExclusao`.
            const destinoComoColuna: Coluna | null = escolhida
              ? colunaDoRascunho(
                  escolhida.ref,
                  escolhida.nome,
                  escolhida.semantic,
                )
              : null;
            const aviso = avisoDeExclusao({
              coluna,
              destino: destinoComoColuna,
              quantas,
              exigeDestino: true,
            });
            const terminal =
              destinoComoColuna !== null &&
              destinoEhTerminal(destinoComoColuna);

            return (
              <div
                key={coluna.id}
                style={{
                  marginTop: 16,
                  padding: 14,
                  borderRadius: 10,
                  border: `1px solid ${terminal ? "var(--danger)" : "var(--border)"}`,
                  background: "var(--surface-2)",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {aviso?.titulo ?? `Apagar "${coluna.name}"`}
                </div>
                {aviso?.linhas.map((l) => (
                  <div
                    key={l}
                    className="muted"
                    style={{ fontSize: 13, marginTop: 4 }}
                  >
                    {l}
                  </div>
                ))}

                <div className="field" style={{ marginTop: 10 }}>
                  <label
                    className="label"
                    htmlFor={`destino-${coluna.id}`}
                  >
                    {/* Um nó de texto só: o leitor de tela não anuncia em pedaços. */}
                    {`Para onde vão as tarefas de ${coluna.name}`}
                  </label>
                  <select
                    id={`destino-${coluna.id}`}
                    className="input"
                    value={escolhas[coluna.id] ?? ""}
                    disabled={ocupado}
                    onChange={(e) =>
                      setEscolhas((a) => ({
                        ...a,
                        [coluna.id]: e.target.value,
                      }))
                    }
                  >
                    <option value="">Escolha uma coluna…</option>
                    {opcoes.map((d) => (
                      <option key={d.ref} value={d.ref}>
                        {ehNova(d.ref) ? `${d.nome} (nova)` : d.nome}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })
        )}

        {erro && (
          <div className="error-text" role="alert" style={{ marginTop: 14 }}>
            {erro}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 20,
          }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onVoltar}
            disabled={ocupado}
          >
            Voltar
          </button>
          {/* Vermelho sempre que há exclusão: não há desfazer nem confirmação digitada. */}
          <button
            type="button"
            className={marcadas.length > 0 ? "btn btn-danger" : "btn btn-primary"}
            disabled={!podeConfirmar}
            onClick={() => onConfirmar(escolhas)}
          >
            {ocupado ? "Aplicando…" : "Confirmar alterações"}
          </button>
        </div>
    </CaixaDeDialogo>
  );
}
