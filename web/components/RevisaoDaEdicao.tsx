"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Coluna } from "@/lib/coluna";
import { avisoDeExclusao, destinoEhTerminal } from "@/lib/edicaoDeColunas";
// ⚠️ O TIPO VEIO PARA `lib` (13/08). Ele descreve o DADO que a revisao
// consome, e o dado e montado por `destinosDoRascunho` -- deixa-lo no
// componente obrigava o `lib` a nao ter tipo proprio, ou o `Board` a importar
// tipo de um componente para chamar uma funcao de `lib`.
import {
  colunaDoRascunho,
  ehNova,
  type DestinoPossivel,
} from "@/lib/rascunhoDeColunas";
export type { DestinoPossivel };

/**
 * A revisão que abre ao concluir a edição (Spec 036, fatia 6c-3).
 *
 * ⚠️ ELA É A ÚLTIMA CHANCE, E NÃO UMA FORMALIDADE. Depois de confirmar, as
 * tarefas foram movidas -- ou concluídas, com cascata nas subtarefas,
 * `terminal_since` ligado e fila de arquivamento. **Nenhum "descartar" desfaz
 * isso.** Apagar é a única operação irreversível do modo de edição, e é por ela
 * que esta tela existe.
 *
 * ⚠️ SÓ APARECE SE HOUVER COLUNA MARCADA. Renomear, criar e reordenar não têm o
 * que perguntar -- e uma confirmação sobre eles ensinaria que a fricção não
 * significa nada, e aí ela para de funcionar onde importa.
 *
 * ⚠️ AS CONTAGENS VÊM DE FORA, buscadas AGORA. Entre marcar o "×" e concluir,
 * alguém pode ter criado tarefa naquela coluna -- o número desta tela tem de
 * ser o do momento da decisão, e não o de quando a pessoa clicou.
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
  /** As colunas que SOBRAM, incluindo as `tmp:` criadas no rascunho. */
  destinos: readonly DestinoPossivel[];
  /** `id da coluna -> tarefas VIVAS`. `null` enquanto carrega. */
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
      // ⚠️ AS OUTRAS MARCADAS NÃO ENTRAM. Mandar tarefas para uma coluna que o
      // mesmo lote apaga produziria um encadeamento que ninguém pediu -- e o
      // backend aplicaria as exclusões na ordem da lista, então o resultado
      // dependeria de qual "×" foi clicado primeiro.
      mapa[c.id] = destinos.filter(
        (d) => d.ref !== c.id && !marcadas.some((m) => m.id === d.ref),
      );
    }
    return mapa;
  }, [marcadas, destinos]);

  // ⚠️ TODA COLUNA MARCADA PRECISA DE DESTINO, mesmo a que parece vazia -- e
  // isso conserta por construção o beco sem saída da 5b-7. A contagem da tela
  // conta só as tarefas VIVAS, mas o backend exige destino se houver vivas OU
  // APAGADAS (a FK `task_board_column` é `RESTRICT`). Antes, a tela dizia "está
  // vazia", escondia o seletor, e a recusa vinha sem ter onde escolher.
  useEffect(() => {
    setEscolhas((atuais) => {
      const novo = { ...atuais };
      for (const c of marcadas) {
        const opcoes = opcoesPorColuna[c.id] ?? [];
        if (!novo[c.id] && opcoes.length > 0) {
          const vazia = (contagens?.[c.id] ?? 0) === 0;
          // ⚠️ SÓ PRÉ-SELECIONA A COLUNA QUE PARECE VAZIA. Com tarefas dentro,
          // a escolha tem consequência -- pré-selecionar faria alguém confirmar
          // sem ler, e a primeira opção pode ser terminal.
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
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(16,24,40,0.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "8vh 16px 24px",
      }}
    >
      <div
        ref={caixaRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Revisar alterações das colunas"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !ocupado) {
            e.stopPropagation();
            onVoltar();
          }
        }}
        style={{
          width: 560,
          maxWidth: "100%",
          maxHeight: "84vh",
          overflowY: "auto",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: 22,
          boxShadow: "var(--shadow)",
        }}
      >
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
          Revisar alterações
        </h2>

        {/* ⚠️ O RESUMO VEM PRIMEIRO E É CURTO. O que exige leitura é o bloco de
            cada exclusão; misturar renomeações no meio faria a pessoa passar os
            olhos pelo conjunto e perder a única parte irreversível. */}
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
            // ⚠️ O DESTINO `tmp:` VIRA UMA `Coluna` DE MENTIRA só para o aviso.
            // É o que permite reusar `avisoDeExclusao` -- que já carrega o
            // texto endurecido do caso terminal -- em vez de escrever a segunda
            // versão daquelas frases.
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
                    {/* ⚠️ UM NÓ DE TEXTO SÓ. Frase partida em vários elementos
                        não é achada por `getByText` e um leitor de tela a
                        anuncia em pedaços. */}
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
          {/* ⚠️ VERMELHO SEMPRE QUE HÁ EXCLUSÃO, e não só quando o destino é
              terminal. O gesto apaga coluna e move tarefas de outras pessoas,
              numa transação sem desfazer -- e a cor é a única defesa, porque
              aqui não há confirmação digitada. */}
          <button
            type="button"
            className={marcadas.length > 0 ? "btn btn-danger" : "btn btn-primary"}
            disabled={!podeConfirmar}
            onClick={() => onConfirmar(escolhas)}
          >
            {ocupado ? "Aplicando…" : "Confirmar alterações"}
          </button>
        </div>
      </div>
    </div>
  );
}
