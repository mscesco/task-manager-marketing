"use client";
// components/ResumoDoProjeto.tsx
// A tela inicial do projeto (redesign, 21/10 -- a prancha "Projeto"): os
// números, as tarefas em aberto por coluna, quem está no projeto e os
// detalhes. O quadro continua a um clique ("Ver no quadro", na página).
//
// ⚠️ LÊ AS TAREFAS DE TOPO (`root_only`), como o quadro: os contadores de
// subtarefa vêm prontos em `subtask_*`, e as pessoas em
// `subtree_assignee_ids`. Falhar aqui não derruba a página -- o resumo avisa
// e o resto continua.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import Avatar from "@/components/Avatar";
import Badge from "@/components/Badge";
import Entrada from "@/components/Entrada";
import { Esqueleto } from "@/components/Loading";
import {
  listAllTasks,
  listMembers,
  quadroGeralComIndice,
  type Project,
  type Task,
} from "@/lib/api";
import { deadlineTonePorColuna, type Coluna, type OrigemDaColuna } from "@/lib/coluna";
import { nomeCurto } from "@/lib/people";
import { diaNoWorkspace } from "@/lib/prazo";
import { DUR, EASE } from "@/lib/motion";
import {
  DEADLINE_COLOR,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  deadlineLabel,
} from "@/lib/status";
import { dataParaTela } from "@/lib/baseTable";

const MAX_POR_COLUNA = 5;

function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[11px] font-bold uppercase tracking-[0.06em] text-ink-faint">
      {children}
    </span>
  );
}

function Cartao({
  titulo,
  children,
  className = "",
  ...rest
}: { titulo?: string; children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...rest}
      className={`flex flex-col gap-3 rounded-xl border border-border bg-surface px-5 py-4 ${className}`}
    >
      {titulo && <h2 className="m-0 text-[13px] font-bold text-ink-soft">{titulo}</h2>}
      {children}
    </section>
  );
}

export default function ResumoDoProjeto({
  project,
  nomeDoTime,
}: {
  project: Project;
  /** O nome do time do projeto, quando a página o sabe. */
  nomeDoTime?: string;
}) {
  const [tarefas, setTarefas] = useState<Task[] | null>(null);
  const [indice, setIndice] = useState<Map<string, OrigemDaColuna>>(new Map());
  const [membros, setMembros] = useState<Map<string, string>>(new Map());
  const [falhou, setFalhou] = useState(false);
  const [mostrarConcluidas, setMostrarConcluidas] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    let vivo = true;
    setTarefas(null);
    setFalhou(false);
    Promise.all([
      listAllTasks({ project_id: project.id, root_only: true }),
      quadroGeralComIndice(project.team_id),
    ])
      .then(([ts, { indice: ix }]) => {
        if (!vivo) return;
        setTarefas(ts.items);
        setIndice(ix);
      })
      .catch(() => vivo && setFalhou(true));
    listMembers()
      .then((ms) => vivo && setMembros(new Map(ms.map((m) => [m.id, m.name]))))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [project.id, project.team_id]);

  const resumo = useMemo(() => {
    const vivas = (tarefas ?? []).filter((t) => !t.is_archived);
    const colunaDe = (t: Task): Coluna | undefined => indice.get(t.column_id)?.coluna;
    const concluida = (t: Task) => colunaDe(t)?.semantic === "DONE";
    const atrasada = (t: Task) => {
      const c = colunaDe(t);
      return c ? deadlineTonePorColuna(c, t.due_date, t.is_archived, t.due_time) === "overdue" : false;
    };
    const abertas = vivas.filter((t) => !concluida(t));
    const concluidas = vivas.filter(concluida);
    const proximoPrazo = abertas
      .map((t) => t.due_date)
      .filter((d): d is string => !!d)
      .sort()[0];

    // Por coluna, na ordem das colunas; cada grupo com a cor dela.
    const porColuna = new Map<string, { coluna: Coluna; tarefas: Task[] }>();
    for (const t of abertas) {
      const c = colunaDe(t);
      if (!c) continue;
      const g = porColuna.get(c.id) ?? { coluna: c, tarefas: [] };
      g.tarefas.push(t);
      porColuna.set(c.id, g);
    }
    const grupos = [...porColuna.values()].sort((a, b) => a.coluna.position - b.coluna.position);

    const porPessoa = new Map<string, number>();
    for (const t of vivas) {
      for (const id of t.subtree_assignee_ids ?? t.assignee_ids ?? []) {
        porPessoa.set(id, (porPessoa.get(id) ?? 0) + 1);
      }
    }
    const pessoas = [...porPessoa.entries()].sort((a, b) => b[1] - a[1]);

    return {
      total: vivas.length,
      concluidas,
      atrasadas: abertas.filter(atrasada).length,
      proximoPrazo,
      grupos,
      pessoas,
      colunaDe,
      atrasada,
    };
  }, [tarefas, indice]);

  const progresso = resumo.total ? resumo.concluidas.length / resumo.total : 0;

  function linha(t: Task) {
    const tone = resumo.atrasada(t) ? "overdue" : null;
    const ids = t.assignee_ids ?? [];
    return (
      <Link
        key={t.id}
        href={`/tarefa/${t.id}`}
        className="flex items-center gap-2.5 rounded-[10px] border border-border bg-surface px-2.5 py-2 text-ink no-underline transition-[border-color,background-color,transform] duration-200 hover:translate-x-0.5 hover:border-accent hover:bg-surface-2"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-semibold">{t.title}</span>
          {(t.subtask_total ?? 0) > 0 && (
            <span className="text-[11px] text-ink-faint">
              {t.subtask_done ?? 0} de {t.subtask_total} subtarefas
            </span>
          )}
        </span>
        <Badge tone="soft" size="sm" color={PRIORITY_COLOR[t.priority]} className="shrink-0">
          {PRIORITY_LABEL[t.priority] || t.priority}
        </Badge>
        {t.due_date && (
          <Badge
            tone={tone ? "soft" : "neutral"}
            size="sm"
            color={tone ? DEADLINE_COLOR.overdue : undefined}
            className={tone ? "shrink-0" : "shrink-0 bg-surface-2 text-ink-soft"}
          >
            {deadlineLabel(t.due_date, t.due_time)}
          </Badge>
        )}
        {ids.length > 0 ? (
          <span className="flex shrink-0">
            {ids.slice(0, 3).map((id, i) => (
              <Avatar
                key={id}
                id={id}
                name={membros.get(id) ?? ""}
                size="sm"
                title={membros.get(id)}
                className="border-[1.5px] border-surface"
                style={{ marginLeft: i === 0 ? 0 : -6 }}
              />
            ))}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-ink-faint">sem responsável</span>
        )}
      </Link>
    );
  }

  if (falhou) {
    return (
      <p className="muted m-0 text-[13px]" role="status">
        Não consegui carregar as tarefas do projeto. O quadro continua disponível.
      </p>
    );
  }
  if (tarefas === null) return <Esqueleto forma="linhas" rotulo="Carregando o resumo" />;

  return (
    <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* `Entrada` embrulha cada cartão; o `div` de fora é a coluna. */}
      <div className="flex min-w-0 flex-col gap-[18px]">
      <Entrada>
        <Cartao aria-label="Resumo">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <Rotulo>Tarefas</Rotulo>
              <strong className="text-[26px] font-extrabold tracking-[-0.02em]">{resumo.total}</strong>
            </div>
            <div>
              <Rotulo>Concluídas</Rotulo>
              <strong className="text-[26px] font-extrabold tracking-[-0.02em] text-teal">{resumo.concluidas.length}</strong>
            </div>
            <div>
              <Rotulo>Atrasadas</Rotulo>
              <strong className={`text-[26px] font-extrabold tracking-[-0.02em] ${resumo.atrasadas ? "text-danger" : ""}`}>
                {resumo.atrasadas}
              </strong>
            </div>
            <div>
              <Rotulo>Próximo prazo</Rotulo>
              <strong className="text-[15px] font-bold text-amber">
                {resumo.proximoPrazo ? deadlineLabel(resumo.proximoPrazo) : "—"}
              </strong>
            </div>
          </div>
          {/* A barra cresce da esquerda (`scaleX`, só transform). */}
          <span className="block h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <motion.span
              className="block h-full origin-left rounded-full bg-accent"
              style={{ width: `${Math.round(progresso * 100)}%` }}
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: DUR[4], ease: EASE.out, delay: 0.1 }}
            />
          </span>
        </Cartao>

        <Cartao aria-label="Tarefas do projeto">
          <div className="flex items-center gap-2">
            <h2 className="m-0 mr-auto text-[13px] font-bold text-ink-soft">
              Tarefas em aberto · {resumo.total - resumo.concluidas.length}
            </h2>
          </div>
          {resumo.grupos.length === 0 && (
            <span className="muted text-[13px]">Nenhuma tarefa em aberto.</span>
          )}
          {resumo.grupos.map((g) => (
            <div key={g.coluna.id} className="flex flex-col gap-2">
              <p className="m-0 flex items-center gap-1.5 text-[11px] font-bold text-ink-faint">
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: g.coluna.color }} />
                {g.coluna.name} · {g.tarefas.length}
              </p>
              {g.tarefas.slice(0, MAX_POR_COLUNA).map(linha)}
              {g.tarefas.length > MAX_POR_COLUNA && (
                <span className="text-[12px] text-ink-faint">
                  e mais {g.tarefas.length - MAX_POR_COLUNA} no quadro
                </span>
              )}
            </div>
          ))}
          {resumo.concluidas.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost self-start"
              style={{ minHeight: 28, fontSize: 12, padding: "4px 10px" }}
              onClick={() => setMostrarConcluidas((v) => !v)}
            >
              {mostrarConcluidas ? "esconder as concluídas" : `ver as ${resumo.concluidas.length} concluídas`}
            </button>
          )}
          {mostrarConcluidas && resumo.concluidas.map(linha)}
        </Cartao>
      </Entrada>
      </div>

      <div className="flex min-w-0 flex-col gap-[18px]">
      <Entrada>
        <Cartao titulo="Quem está no projeto" aria-label="Pessoas">
          {resumo.pessoas.length === 0 ? (
            <span className="muted text-[13px]">Ninguém designado ainda.</span>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
              {resumo.pessoas.map(([id, n]) => (
                <li key={id} className="flex items-center gap-2">
                  <Avatar id={id} name={membros.get(id) ?? ""} size="md" />
                  <span className="min-w-0 flex-1 truncate">
                    {membros.get(id) ? nomeCurto(membros.get(id)!) : "Alguém"}
                  </span>
                  <span className="text-ink-faint">{n} {n === 1 ? "tarefa" : "tarefas"}</span>
                </li>
              ))}
            </ul>
          )}
        </Cartao>

        <Cartao titulo="Detalhes" aria-label="Detalhes" className="text-[13px]">
          <div className="grid grid-cols-[90px_1fr] items-center gap-x-2.5 gap-y-2">
            {nomeDoTime && (
              <>
                <span className="text-ink-faint">Time</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-[7px] w-[7px] rounded-full bg-teal" />
                  {nomeDoTime}
                </span>
              </>
            )}
            <span className="text-ink-faint">Criado por</span>
            <span>
              {membros.get(project.created_by) ? nomeCurto(membros.get(project.created_by)!) : "—"} ·{" "}
              {dataParaTela(diaNoWorkspace(project.created_at))}
            </span>
            {project.due_date && (
              <>
                <span className="text-ink-faint">Prazo</span>
                <span>{dataParaTela(project.due_date)}</span>
              </>
            )}
            <span className="text-ink-faint">Prioridade</span>
            <span>{PRIORITY_LABEL[project.priority] || project.priority}</span>
          </div>
        </Cartao>
      </Entrada>
      </div>
    </div>
  );
}
