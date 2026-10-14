"use client";
// components/TeamDashboard.tsx
// Os cards da tela inicial do time (Spec 058, fatia D).
//
// ⚠️ SÓ DESENHA. A ordem dos cards, os textos e o que some são de
// `lib/teamDashboard.ts`; os números são do servidor, que também decide quem
// vê o quê (card sem permissão chega `null`).
//
// ANIMAÇÃO (pedido dela, 14/10), com o `motion` que o app já usa:
// - as BARRAS crescem da esquerda com `scaleX`, e NÃO com `width`
//   (web/AGENTS.md §7: só `transform` e `opacity`). A barra inteira existe
//   desde o começo; o que anima é a escala, a partir da origem à esquerda;
// - o CÍRCULO da semana se completa pelo `pathLength` do SVG -- traço, sem
//   mexer no layout;
// - trocar o time na barra anima do valor velho para o novo, e não do zero:
//   o `motion` interpola a partir de onde está;
// - ⚠️ `useReducedMotion`, e não o bloco do `globals.css`: aquele só alcança
//   animação de CSS (o mesmo cuidado de `FileiraDeReacoes`). Com a
//   preferência ligada, tudo aparece já no lugar.

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { motion, useReducedMotion, type Transition } from "motion/react";
import type { DashboardResponse, DashboardTask } from "@/lib/api";
import {
  WORKLOAD_PREVIEW,
  ageLabel,
  cardOrder,
  dayLabel,
  dueLabel,
  weekLabel,
  weekPercent,
  type DashboardCard,
} from "@/lib/teamDashboard";

type Links = {
  /** "Minhas tarefas" com o time da barra (`navHref`). */
  mine: string;
  /** A fila de solicitações com o time da barra. */
  queue: string;
};

export default function TeamDashboard({ data, links }: { data: DashboardResponse; links: Links }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cardOrder(data).map((c) => (
        <Card key={c} card={c} data={data} links={links} />
      ))}
    </div>
  );
}

function Card({ card, data, links }: { card: DashboardCard; data: DashboardResponse; links: Links }) {
  switch (card) {
    case "week":
      return <WeekCard data={data} />;
    case "overdue":
      return <OverdueCard data={data} />;
    case "ahead":
      return <AheadCard data={data} />;
    case "queue":
      return data.queue ? <QueueCard queue={data.queue} today={data.today} link={links.queue} /> : null;
    case "workload":
      return data.workload ? <WorkloadCard people={data.workload} /> : null;
    case "mine":
      return <MineCard data={data} link={links.mine} />;
  }
}

// ------------------------------------------------------------------ cards
function WeekCard({ data }: { data: DashboardResponse }) {
  const { done, total, start, end } = data.week;
  const pct = weekPercent(done, total);
  return (
    <CardFrame title={`Esta semana · ${weekLabel(start, end)}`}>
      {total === 0 ? (
        <Empty>Nenhuma tarefa com prazo nesta semana.</Empty>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <ProgressRing percent={pct} label="Concluídas na semana" />
            <p className="m-0 text-base">
              <strong className="text-3xl font-bold">{done}</strong>
              <span className="text-ink-soft"> de {total} concluídas</span>
            </p>
          </div>
          <p className="muted m-0 mt-3 text-xs">
            Tarefas com prazo de segunda a domingo; canceladas e bloqueadas ficam fora.
          </p>
        </>
      )}
    </CardFrame>
  );
}

function OverdueCard({ data }: { data: DashboardResponse }) {
  return (
    <CardFrame title="Atrasadas" big={data.overdue_total} danger={data.overdue_total > 0}>
      {data.overdue_total === 0 ? (
        <Empty>Nenhuma tarefa atrasada.</Empty>
      ) : (
        <>
          <p className="muted m-0 mb-1 text-xs">As mais antigas:</p>
          <TaskList tasks={data.oldest_overdue} today={data.today} />
        </>
      )}
    </CardFrame>
  );
}

function AheadCard({ data }: { data: DashboardResponse }) {
  const max = Math.max(1, ...data.due_ahead.map((d) => d.count));
  const total = data.due_ahead.reduce((s, d) => s + d.count, 0);
  return (
    <CardFrame title="Próximos 7 dias" big={total}>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {data.due_ahead.map((d, i) => (
          <li key={d.date} className="flex items-center gap-2 text-sm">
            <span className="w-16 shrink-0 text-ink-soft">{dayLabel(d.date, data.today)}</span>
            <Bar className="flex-1" order={i} parts={[{ fraction: d.count / max, tone: "accent" }]} />
            <span className="w-6 shrink-0 text-right tabular-nums">{d.count}</span>
          </li>
        ))}
      </ul>
    </CardFrame>
  );
}

function QueueCard({
  queue,
  today,
  link,
}: {
  queue: NonNullable<DashboardResponse["queue"]>;
  today: string;
  link: string;
}) {
  return (
    <CardFrame title="Solicitações pendentes" big={queue.pending}>
      {queue.pending === 0 || !queue.oldest_at ? (
        <Empty>A fila está em dia.</Empty>
      ) : (
        <p className="m-0 text-sm text-ink-soft">
          A mais antiga chegou {ageLabel(queue.oldest_at, today)}.
        </p>
      )}
      <Link href={link} className="mt-2 inline-block text-sm text-accent">
        Abrir a fila
      </Link>
    </CardFrame>
  );
}

function WorkloadCard({ people }: { people: NonNullable<DashboardResponse["workload"]> }) {
  const [showAll, setShowAll] = useState(false);
  const max = Math.max(1, ...people.map((p) => p.open));
  const shown = showAll ? people : people.slice(0, WORKLOAD_PREVIEW);
  return (
    <CardFrame title="Tarefas abertas por pessoa">
      {people.length === 0 ? (
        <Empty>Ninguém neste time ainda.</Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {shown.map((p, i) => (
            <li key={p.user_id} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">{p.name}</span>
                <span className="shrink-0 tabular-nums text-ink-soft">
                  {p.open}
                  {p.overdue > 0 && (
                    <span className="text-danger">
                      {" "}
                      · {p.overdue} atrasada{p.overdue === 1 ? "" : "s"}
                    </span>
                  )}
                </span>
              </div>
              {/* A parte vermelha é a atrasada, DENTRO da barra das abertas:
                  as duas partem da esquerda, e a vermelha fica por cima. */}
              <Bar
                className="mt-1"
                order={i}
                parts={[
                  { fraction: p.open / max, tone: "accent" },
                  { fraction: p.overdue / max, tone: "danger" },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
      {people.length > WORKLOAD_PREVIEW && (
        <button
          type="button"
          className="btn btn-ghost mt-2 self-start text-sm"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Ver menos" : `Ver todos (${people.length})`}
        </button>
      )}
    </CardFrame>
  );
}

function MineCard({ data, link }: { data: DashboardResponse; link: string }) {
  const { overdue, overdue_total, due_today, due_today_total } = data.mine;
  return (
    <CardFrame title="Minhas para hoje">
      {overdue_total + due_today_total === 0 ? (
        <Empty>Nada atrasado nem vencendo hoje.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {overdue_total > 0 && (
            <section>
              <p className="m-0 mb-1 text-xs font-semibold text-danger">Atrasadas ({overdue_total})</p>
              <TaskList tasks={overdue} today={data.today} />
            </section>
          )}
          {due_today_total > 0 && (
            <section>
              <p className="m-0 mb-1 text-xs font-semibold text-ink-soft">
                Vencem hoje ({due_today_total})
              </p>
              <TaskList tasks={due_today} today={data.today} />
            </section>
          )}
        </div>
      )}
      <Link href={link} className="mt-2 inline-block text-sm text-accent">
        Ver todas as minhas tarefas
      </Link>
    </CardFrame>
  );
}

// ------------------------------------------------------------------ peças
function CardFrame({
  title,
  big,
  danger = false,
  children,
}: {
  title: string;
  big?: number;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-lg border border-border bg-surface p-4" aria-label={title}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold text-ink-soft">{title}</h2>
        {big !== undefined && (
          <span className={`text-2xl font-bold tabular-nums ${danger ? "text-danger" : ""}`}>{big}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function TaskList({ tasks, today }: { tasks: DashboardTask[]; today: string }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-baseline justify-between gap-2 text-sm">
          <Link href={`/tarefa/${t.id}`} className="min-w-0 truncate text-ink hover:text-accent">
            {t.title}
          </Link>
          <span className="shrink-0 text-xs text-ink-faint">{dueLabel(t, today)}</span>
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="muted m-0 text-sm">{children}</p>;
}

// ------------------------------------------------------------------ animação
/** A mola das barras e do círculo: sem quicar, curta o bastante para não
 *  atrasar quem abre o painel todo dia. */
const GROW: Transition = { type: "spring", duration: 0.7, bounce: 0 };
/** Cada barra começa um pouco depois da de cima -- a lista "se desenha". */
const STAGGER = 0.04;

/**
 * Uma barra horizontal. Cada parte é uma camada da largura INTEIRA da trilha,
 * escalada de 0 até a fração (`scaleX`, origem à esquerda); as de depois ficam
 * por cima das de antes.
 */
function Bar({
  parts,
  order = 0,
  className = "",
}: {
  parts: { fraction: number; tone: "accent" | "danger" }[];
  /** A posição na lista, para o atraso escalonado. */
  order?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <span
      className={`relative block h-2 overflow-hidden rounded-full bg-border ${className}`}
      aria-hidden="true"
    >
      {parts.map((part, i) => (
        <motion.span
          key={i}
          className={`absolute inset-0 origin-left ${part.tone === "danger" ? "bg-danger" : "bg-accent"}`}
          initial={reduce ? false : { scaleX: 0 }}
          animate={{ scaleX: Math.min(1, Math.max(0, part.fraction)) }}
          transition={reduce ? { duration: 0 } : { ...GROW, delay: order * STAGGER }}
        />
      ))}
    </span>
  );
}

/** O círculo da semana: a trilha inteira e, por cima, o arco do concluído. */
function ProgressRing({ percent, label }: { percent: number; label: string }) {
  const reduce = useReducedMotion();
  const size = 88;
  const stroke = 10;
  const r = (size - stroke) / 2;
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      {/* `-rotate-90`: o arco começa no topo, como um relógio. */}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-border" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className="stroke-accent"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: percent / 100 }}
          transition={reduce ? { duration: 0 } : { ...GROW, duration: 0.9 }}
          // ⚠️ 0% com `strokeLinecap="round"` ainda desenharia um pontinho.
          style={{ opacity: percent === 0 ? 0 : 1 }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-base font-bold">
        {percent}%
      </span>
    </div>
  );
}
