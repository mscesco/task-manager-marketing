"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import CaixaDeDialogo from "@/components/CaixaDeDialogo";
import {
  ApiError,
  listBoards,
  listTeamsAll,
  relocateTask,
  searchBoardTasks,
  type Task,
} from "@/lib/api";
import {
  caminhoDoAchado,
  corpoDoMover,
  destinoAtual,
  destinosDoMover,
  frasesDaPrevia,
  type AchadoDaBusca,
  type Destino,
  type ModoDoMover,
  type PreviaDoMover,
} from "@/lib/moverTarefa";

/**
 * O modal "Mover…" (Spec 062): quadro, "vai como" e, se for subtarefa, a
 * busca da tarefa principal com o caminho inteiro.
 *
 * ⚠️ A PREVIA E O PROPRIO SERVIDOR (`dry_run`), refeita a cada escolha. O que
 * ela diz -- quem sai, quem assume, o projeto -- e o que o "Mover" vai fazer:
 * o servidor roda a operacao num savepoint e desfaz.
 */
export default function MoverTarefa({
  task,
  onMovida,
  onFechar,
}: {
  task: Pick<Task, "id" | "title" | "board_id" | "team_id" | "parent_task_id">;
  onMovida: (t: Task) => void;
  onFechar: () => void;
}) {
  const [destinos, setDestinos] = useState<Destino[] | null>(null);
  const [destino, setDestino] = useState<Destino | null>(null);
  const [modo, setModo] = useState<ModoDoMover>(
    task.parent_task_id ? "subtarefa" : "principal",
  );
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<AchadoDaBusca[] | null>(null);
  const [mae, setMae] = useState<AchadoDaBusca | null>(null);
  const [previa, setPrevia] = useState<PreviaDoMover | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // O erro do MOVER mora separado do da previa (auditoria 11/11, item 7):
  // juntos, uma falha de rede desligava o botao ate trocar de destino.
  const [erroAoMover, setErroAoMover] = useState<string | null>(null);
  const [movendo, setMovendo] = useState(false);
  const seletorRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    let vivo = true;
    Promise.all([listBoards(), listTeamsAll()])
      .then(([quadros, times]) => {
        if (!vivo) return;
        const lista = destinosDoMover(quadros, times);
        setDestinos(lista);
        setDestino(destinoAtual(lista, task) ?? lista[0] ?? null);
      })
      .catch(() => vivo && setErro("Não consegui carregar os quadros."));
    return () => {
      vivo = false;
    };
    // So ao abrir: o quadro de partida e o de quando o modal abriu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  useEffect(() => {
    seletorRef.current?.focus();
  }, [destinos]);

  // A busca: refeita ao digitar e ao trocar de quadro.
  useEffect(() => {
    if (!destino || modo !== "subtarefa") return;
    let vivo = true;
    const t = setTimeout(() => {
      searchBoardTasks(destino.board_id, busca, task.id)
        .then((r) => vivo && setAchados(r))
        .catch(() => vivo && setAchados([]));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [destino, modo, busca, task.id]);

  const corpo = useMemo(
    () => (destino ? corpoDoMover(destino, modo, mae?.id ?? null) : null),
    [destino, modo, mae],
  );

  // A previa: o servidor faz de conta (`dry_run`).
  useEffect(() => {
    setPrevia(null);
    setErro(null);
    setErroAoMover(null);
    if (!corpo) return;
    let vivo = true;
    const t = setTimeout(() => {
      relocateTask(task.id, corpo, true)
        .then((r) => vivo && setPrevia(r))
        .catch((e) => vivo && setErro(mensagemDeErro(e)));
    }, 200);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [corpo, task.id]);

  async function mover() {
    if (!corpo || movendo) return;
    setMovendo(true);
    setErroAoMover(null);
    try {
      const r = await relocateTask(task.id, corpo, false);
      if (r.task) onMovida(r.task);
      onFechar();
    } catch (e) {
      setErroAoMover(mensagemDeErro(e));
      setMovendo(false);
    }
  }

  const frases = previa ? frasesDaPrevia(previa) : [];
  const podeMover = !!corpo && !!previa?.mudou && !erro && !movendo;
  const areas = destinos ? [...new Set(destinos.map((d) => d.area))] : [];

  return (
    <CaixaDeDialogo
      ariaLabel={`Mover a tarefa ${task.title}`}
      largura={520}
      // Durante o "Movendo…" o Esc e ENGOLIDO, e nao ignorado (auditoria
      // 11/11, item 6): sem dono, ele subia ao detalhe, que fechava -- e o
      // erro de um movimento que falhasse nao aparecia em lugar nenhum.
      onEsc={movendo ? () => {} : onFechar}
      onFundo={movendo ? undefined : onFechar}
    >
      <div className="text-[15px] font-bold">
        Mover &quot;{task.title}&quot;
      </div>

      <label htmlFor="mover-quadro" className="mt-4 block text-[13px] font-semibold">
        Quadro
      </label>
      <select
        id="mover-quadro"
        ref={seletorRef}
        className="input mt-1.5 w-full"
        value={destino?.chave ?? ""}
        disabled={!destinos || movendo}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          setDestino(destinos?.find((d) => d.chave === e.target.value) ?? null);
          setMae(null);
          // Sem isto, o resultado do quadro anterior fica na tela ate chegar o novo.
          setAchados(null);
        }}
      >
        {!destinos && <option value="">Carregando…</option>}
        {areas.map((area) => (
          <optgroup key={area} label={area}>
            {destinos!
              .filter((d) => d.area === area)
              .map((d) => (
                <option key={d.chave} value={d.chave}>
                  {d.rotulo}
                </option>
              ))}
          </optgroup>
        ))}
      </select>

      <fieldset className="mt-4" disabled={movendo}>
        <legend className="text-[13px] font-semibold">Vai como</legend>
        <div className="mt-1.5 flex gap-5">
          {(
            [
              ["principal", "Tarefa principal"],
              ["subtarefa", "Subtarefa de…"],
            ] as const
          ).map(([valor, rotulo]) => (
            <label key={valor} className="flex min-h-6 cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="radio"
                name="mover-modo"
                value={valor}
                checked={modo === valor}
                onChange={() => {
                  setModo(valor);
                  setMae(null);
                }}
              />
              {rotulo}
            </label>
          ))}
        </div>
      </fieldset>

      {modo === "subtarefa" && (
        <div className="mt-3">
          <label htmlFor="mover-busca" className="sr-only">
            Buscar a tarefa principal
          </label>
          <input
            id="mover-busca"
            className="input w-full"
            placeholder="Buscar tarefa neste quadro…"
            value={busca}
            autoComplete="off"
            disabled={movendo}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              setBusca(e.target.value);
              // A escolhida sai da lista com a busca nova: valendo escondida,
              // a tarefa ia para baixo de quem a tela nao mostra mais
              // (auditoria 11/11, item 8).
              setMae(null);
            }}
          />
          <ul
            className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border"
            aria-label="Tarefas encontradas"
          >
            {achados === null ? (
              <li className="muted px-3 py-2 text-[13px]">Buscando…</li>
            ) : achados.length === 0 ? (
              <li className="muted px-3 py-2 text-[13px]">Nenhuma tarefa encontrada.</li>
            ) : (
              achados.map((a) => {
                const escolhida = mae?.id === a.id;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      aria-pressed={escolhida}
                      disabled={movendo}
                      onClick={() => setMae(a)}
                      className={`block w-full min-w-0 truncate px-3 py-2 text-left text-[13px] hover:bg-surface-2 ${
                        escolhida ? "bg-accent-soft font-semibold" : ""
                      }`}
                      title={caminhoDoAchado(a)}
                    >
                      {a.caminho.length > 0 && (
                        <span className="text-ink-faint">{a.caminho.join(" › ")} › </span>
                      )}
                      {a.title}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}

      <div className="mt-4 min-h-10 text-[13px]" aria-live="polite">
        {erro || erroAoMover ? (
          <div role="alert" className="error-text">
            {erro ?? erroAoMover}
          </div>
        ) : modo === "subtarefa" && !mae ? (
          <div className="muted">Escolha a tarefa principal.</div>
        ) : !previa ? (
          corpo && <div className="muted">Calculando o que muda…</div>
        ) : !previa.mudou ? (
          <div className="muted">A tarefa já está nesse lugar.</div>
        ) : (
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {frases.length === 0 ? <li>Só a tarefa muda de lugar.</li> : frases.map((f) => <li key={f}>{f}</li>)}
          </ul>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2.5">
        <button type="button" className="btn btn-ghost" onClick={onFechar} disabled={movendo}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary" onClick={mover} disabled={!podeMover}>
          {movendo ? "Movendo…" : "Mover"}
        </button>
      </div>
    </CaixaDeDialogo>
  );
}

function mensagemDeErro(e: unknown): string {
  const err = e as ApiError;
  if (err?.status === 403) return "Você não pode mover esta tarefa.";
  if (err?.status === 404) return "Tarefa ou quadro não encontrado, ou sem acesso.";
  return err?.message || "Não consegui mover a tarefa.";
}
